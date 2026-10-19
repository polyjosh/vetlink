import { and, asc, desc, eq, gte, ilike, isNull, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { interpolate, messages, type Locale } from '@vetlink/i18n';
import { servicesForProblem, type ProblemType, type Species } from '@vetlink/shared';
import type { AppContext } from '../../context.js';
import {
  animals,
  bookings,
  farmers,
  locations,
  reminders,
  users,
  ussdSessions,
} from '../../db/schema/index.js';
import { DomainError } from '../../lib/errors.js';
import { maskPhone } from '../../lib/phone.js';
import { currentBookingFee, quotePriceRange } from '../bookings/pricing.js';
import { createBooking } from '../bookings/service.js';
import { requestDeposit } from '../payments/service.js';
import { chooseRole, giveConsent } from '../users/service.js';

/**
 * USSD engine (§8.1). Africa's Talking sends the whole input history as `text` (`1*2*3`), so
 * every request replays the inputs from the start through the same screens. Screens are only
 * rendered once the inputs run out. What the session started with (needs onboarding, language,
 * saved ward) is snapshotted on the first request, so the replay stays the same even after a
 * step has written data (consent, language).
 *
 * The engine is an adapter: bookings, consent and roles go through the same services as the app.
 */

export interface UssdRequest {
  sessionId: string;
  /** Normalized `2547…`. */
  phone: string;
  text: string;
}

export interface UssdResponse {
  kind: 'CON' | 'END';
  text: string;
}

/** Thrown to stop the replay and answer with a screen. */
class Screen {
  constructor(
    readonly kind: 'CON' | 'END',
    readonly text: string,
  ) {}
}

interface Snapshot {
  onboarding: boolean;
  lang: Locale;
  savedWard: { id: number; name: string } | null;
}

// Menu option → value. USSD offers a short list; "Goat/Sheep" books as goat (§8.1).
const REQUEST_SPECIES: readonly Species[] = ['cattle', 'goat', 'poultry', 'other'];
const ADD_SPECIES: readonly Species[] = ['cattle', 'goat', 'sheep', 'poultry', 'pig', 'other'];
const PROBLEMS: readonly (ProblemType | 'emergency')[] = [
  'sick',
  'injury',
  'breeding',
  'vaccination',
  'emergency',
];

const pick =
  <T>(options: readonly T[]) =>
  (input: string): T | undefined =>
    /^\d+$/.test(input) ? options[Number(input) - 1] : undefined;

const MAX_WARD_MATCHES = 5;

export async function handleUssd(
  ctx: AppContext,
  req: UssdRequest,
  log: FastifyBaseLogger,
): Promise<UssdResponse> {
  try {
    await run(ctx, req, log);
    // `run` always ends by throwing a Screen.
    throw new Error('USSD flow ended without a screen');
  } catch (err) {
    if (err instanceof Screen) return { kind: err.kind, text: err.text };
    log.error({ err, phone: maskPhone(req.phone) }, 'USSD request failed');
    const lang = await languageOf(ctx, req.phone);
    return { kind: 'END', text: messages[lang].ussd.error };
  }
}

async function languageOf(ctx: AppContext, phone: string): Promise<Locale> {
  const [u] = await ctx.db
    .select({ language: users.language })
    .from(users)
    .where(and(eq(users.phone, phone), isNull(users.deletedAt)))
    .limit(1);
  return u?.language ?? 'sw';
}

async function findUser(ctx: AppContext, phone: string) {
  const [u] = await ctx.db
    .select()
    .from(users)
    .where(and(eq(users.phone, phone), isNull(users.deletedAt)))
    .limit(1);
  return u;
}

/** The session's starting point: taken on its first request, then reused for every replay. */
async function snapshot(ctx: AppContext, req: UssdRequest): Promise<Snapshot> {
  const [existing] = await ctx.db
    .select()
    .from(ussdSessions)
    .where(eq(ussdSessions.sessionId, req.sessionId))
    .limit(1);
  if (existing && existing.phone === req.phone) {
    return existing.data as unknown as Snapshot;
  }
  const user = await findUser(ctx, req.phone);
  let savedWard: Snapshot['savedWard'] = null;
  if (user) {
    const [row] = await ctx.db
      .select({ id: locations.id, name: locations.ward })
      .from(farmers)
      .innerJoin(locations, eq(locations.id, farmers.wardId))
      .where(eq(farmers.userId, user.id))
      .limit(1);
    savedWard = row ?? null;
  }
  const snap: Snapshot = {
    onboarding: !user?.consentAt,
    lang: user?.language ?? 'sw',
    savedWard,
  };
  await ctx.db
    .insert(ussdSessions)
    .values({
      sessionId: req.sessionId,
      phone: req.phone,
      state: 'started',
      data: snap,
      updatedAt: ctx.clock(),
    })
    .onConflictDoNothing();
  return snap;
}

/** Ensure a consented USSD user is a farmer with a profile (USSD is the farmer channel). */
async function ensureFarmer(ctx: AppContext, userId: string): Promise<void> {
  await chooseRole(ctx, userId, { role: 'farmer' });
}

async function run(ctx: AppContext, req: UssdRequest, log: FastifyBaseLogger): Promise<never> {
  const inputs = req.text === '' ? [] : req.text.split('*');
  let at = 0;
  const snap = await snapshot(ctx, req);
  let lang = snap.lang;
  const t = () => messages[lang].ussd;

  /** Ask for input; re-show the screen (with an error line) until a valid answer is given. */
  const ask = <T>(render: () => string, parse: (input: string) => T | undefined): T => {
    let invalid = false;
    for (;;) {
      const input = inputs[at];
      if (input === undefined) {
        throw new Screen('CON', (invalid ? `${t().invalid}\n` : '') + render());
      }
      at += 1;
      const value = parse(input.trim());
      if (value !== undefined) return value;
      invalid = true;
    }
  };
  const end = (text: string): never => {
    throw new Screen('END', text);
  };

  // ---- Onboarding: language, then consent (§17) ----
  let user = await findUser(ctx, req.phone);
  if (snap.onboarding) {
    lang = ask(() => t().welcome, pick<Locale>(['sw', 'en']));
    const agreed = ask(() => t().consent, pick([true, false]));
    if (!agreed) end(t().consentDeclined);
    if (!user?.consentAt) {
      user = await upsertUssdUser(ctx, req.phone, lang);
    }
  }
  if (!user) return end(t().error);
  const userId = user.id;
  await ensureFarmer(ctx, userId);

  // ---- Main menu ----
  const choice = ask(
    () => t().mainMenu,
    pick(['request', 'animals', 'reminders', 'history'] as const),
  );
  if (choice === 'request') return requestVet();
  if (choice === 'animals') return myAnimals();
  if (choice === 'reminders') return myReminders();
  return myHistory();

  async function requestVet(): Promise<never> {
    const species = ask(() => t().chooseAnimal, pick(REQUEST_SPECIES));
    const problem = ask(() => t().chooseProblem, pick(PROBLEMS));
    const isEmergency = problem === 'emergency';
    const problemType: ProblemType = isEmergency ? 'sick' : problem;

    // Emergency NOW skips the location question when a ward is saved (§8.1).
    let ward = snap.savedWard;
    if (!(isEmergency && ward)) {
      const useSaved = ward
        ? ask(
            () => interpolate(t().chooseLocation, { ward: ward?.name ?? '' }),
            pick([true, false]),
          )
        : false;
      if (!useSaved) ward = await askWard();
    }
    if (!ward) return end(t().error);
    const chosenWard = ward;

    // USSD cannot tick extra services in 160 characters: the problem implies them (§24.3).
    const services = servicesForProblem(problemType);
    const bookingFee = await currentBookingFee(ctx);
    // The same server-side quote the booking stores (§8.6: fees are shown before commitment).
    const range = await quotePriceRange(
      ctx,
      { wardId: chosenWard.id, species, services },
      bookingFee,
    );
    const kes = (n: number) => n.toLocaleString('en-KE');
    const vars = {
      animal: t().species[species],
      problem: t().problems[problemType],
      ward: chosenWard.name,
      price: !range
        ? t().priceUnknown
        : range.min === range.max
          ? kes(range.min)
          : `${kes(range.min)}-${kes(range.max)}`,
      deposit: bookingFee,
    };
    const confirmed = ask(
      () => interpolate(isEmergency ? t().confirmEmergency : t().confirm, vars),
      pick([true, false]),
    );
    if (!confirmed) return end(t().cancelled);

    const { booking } = await createBooking(ctx, {
      farmerId: userId,
      channel: 'ussd',
      // One booking per USSD session, even if the final request is delivered twice.
      idempotencyKey: `ussd-${req.sessionId}`,
      species,
      problemType,
      isEmergency,
      wardId: chosenWard.id,
      services,
    });
    // First booking from a new number: remember the ward for next time.
    if (!snap.savedWard) {
      await ctx.db
        .update(farmers)
        .set({ wardId: chosenWard.id })
        .where(and(eq(farmers.userId, userId), isNull(farmers.wardId)));
    }
    await markSession(ctx, req.sessionId, 'booked', { bookingId: booking.id });
    // The deposit prompt arrives on the phone once this USSD session closes.
    try {
      await requestDeposit(ctx, { bookingId: booking.id, farmerId: userId }, log);
    } catch (err) {
      if (!(err instanceof DomainError && err.code === 'payment_unavailable')) throw err;
      return end(
        interpolate(t().requestedNoStk, { ref: booking.id, deposit: booking.bookingFeeKes }),
      );
    }
    return end(interpolate(t().requested, { ref: booking.id, deposit: booking.bookingFeeKes }));
  }

  /** Search wards by name until the farmer picks one. */
  async function askWard(): Promise<{ id: number; name: string }> {
    let query = ask(
      () => t().enterWard,
      (s) => (s.length >= 2 ? s : undefined),
    );
    for (;;) {
      const matches = await searchWards(ctx, query);
      if (matches.length > 0) {
        const options = matches
          .map((m, i) => `${i + 1}. ${m.name}${m.subCounty !== m.name ? ` (${m.subCounty})` : ''}`)
          .join('\n');
        // A non-number here is taken as a new search.
        const input = inputs[at];
        if (input !== undefined && !/^\d+$/.test(input.trim())) {
          at += 1;
          query = input.trim();
          continue;
        }
        return ask(() => interpolate(t().chooseWard, { options }), pick(matches));
      }
      query = ask(
        () => interpolate(t().wardNotFound, { query: query.slice(0, 30) }),
        (s) => (s.length >= 2 ? s : undefined),
      );
    }
  }

  async function myAnimals(): Promise<never> {
    const list = await ctx.db
      .select()
      .from(animals)
      .where(eq(animals.farmerId, userId))
      .orderBy(asc(animals.nameOrTag))
      .limit(5);
    const lines = list.map((a) => `${a.nameOrTag ?? '-'} (${t().species[a.species]})`).join('\n');
    ask(
      () => (list.length ? interpolate(t().animalsList, { list: lines }) : t().animalsEmpty),
      pick([true]),
    );
    const species = ask(() => t().addAnimalSpecies, pick(ADD_SPECIES));
    const name = ask(
      () => t().addAnimalName,
      (s) => (s.length >= 1 && s.length <= 40 ? s : undefined),
    );
    // A resent final request must not save the animal twice.
    const saved = await markSession(ctx, req.sessionId, 'animal_saved', { text: req.text });
    if (saved) {
      await ctx.db.insert(animals).values({ farmerId: userId, species, nameOrTag: name });
    }
    return end(interpolate(t().animalSaved, { name }));
  }

  async function myReminders(): Promise<never> {
    const today = ctx.clock().toISOString().slice(0, 10);
    const rows = await ctx.db
      .select({ type: reminders.type, dueDate: reminders.dueDate, name: animals.nameOrTag })
      .from(reminders)
      .innerJoin(animals, eq(animals.id, reminders.animalId))
      .where(and(eq(animals.farmerId, userId), gte(reminders.dueDate, today)))
      .orderBy(asc(reminders.dueDate))
      .limit(3);
    if (rows.length === 0) return end(t().remindersEmpty);
    const list = rows
      .map((r) => `${shortDate(r.dueDate)} ${t().reminderTypes[r.type]} ${r.name ?? ''}`.trim())
      .join('\n');
    return end(interpolate(t().reminders, { list }));
  }

  async function myHistory(): Promise<never> {
    const rows = await ctx.db
      .select()
      .from(bookings)
      .where(eq(bookings.farmerId, userId))
      .orderBy(desc(bookings.id))
      .limit(3);
    if (rows.length === 0) return end(t().historyEmpty);
    const list = rows
      .map(
        (b) =>
          `#${b.id} ${t().species[b.species]} ${shortDate(b.createdAt.toISOString())}: ${t().statuses[b.status]}`,
      )
      .join('\n');
    return end(interpolate(t().history, { list }));
  }
}

const shortDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Create (or update) the account for a new USSD number: language, consent, farmer role. */
async function upsertUssdUser(ctx: AppContext, phone: string, lang: Locale) {
  await ctx.db
    .insert(users)
    .values({ phone, language: lang, createdAt: ctx.clock() })
    .onConflictDoNothing({ target: users.phone, where: isNull(users.deletedAt) });
  const user = await findUser(ctx, phone);
  if (!user) throw new DomainError('not_found');
  await ctx.db.update(users).set({ language: lang }).where(eq(users.id, user.id));
  await giveConsent(ctx, user.id);
  await chooseRole(ctx, user.id, { role: 'farmer' });
  return findUser(ctx, phone);
}

async function searchWards(ctx: AppContext, query: string) {
  const q = query.replace(/[%_\\]/g, '').trim();
  if (q.length < 2) return [];
  const rows = await ctx.db
    .select({ id: locations.id, name: locations.ward, subCounty: locations.subCounty })
    .from(locations)
    .where(ilike(locations.ward, `${q}%`))
    .orderBy(asc(locations.ward))
    .limit(MAX_WARD_MATCHES);
  if (rows.length > 0) return rows;
  return ctx.db
    .select({ id: locations.id, name: locations.ward, subCounty: locations.subCounty })
    .from(locations)
    .where(ilike(locations.ward, `%${q}%`))
    .orderBy(asc(locations.ward))
    .limit(MAX_WARD_MATCHES);
}

/**
 * Record a step on the session. Returns false if the session already recorded this state
 * (a resent request), so one-off side effects can be skipped.
 */
async function markSession(
  ctx: AppContext,
  sessionId: string,
  state: string,
  extra: Record<string, unknown>,
): Promise<boolean> {
  const updated = await ctx.db
    .update(ussdSessions)
    .set({
      state,
      data: sql`${ussdSessions.data} || ${JSON.stringify(extra)}::jsonb`,
      updatedAt: ctx.clock(),
    })
    .where(and(eq(ussdSessions.sessionId, sessionId), eq(ussdSessions.state, 'started')))
    .returning({ sessionId: ussdSessions.sessionId });
  return updated.length > 0;
}
