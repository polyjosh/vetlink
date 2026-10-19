import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { interpolate, messages, type Locale } from '@vetlink/i18n';
import { ACTIVE_JOB_STATUSES } from '@vetlink/shared';
import type { AppContext } from '../../context.js';
import {
  bookingOffers,
  bookings,
  farmers,
  locations,
  ratings,
  smsInbound,
  users,
  vets,
} from '../../db/schema/index.js';
import { DomainError } from '../../lib/errors.js';
import { maskPhone } from '../../lib/phone.js';
import {
  acceptOffer,
  completeByVet,
  declineOffer,
  rateBooking,
  vetStep,
} from '../bookings/service.js';
import { setAvailability } from '../vets/service.js';
import { parseSmsCommand, type SmsCommand } from './parser.js';

/**
 * SMS commands (§8.4). An adapter: every command calls the same service as the app, so "anything
 * a vet does by SMS produces the same result as the app" (approval gating, first-accept-wins,
 * exactly-once completion). Raw text is stored before anything is parsed.
 */

export const SMS_RATE_LIMIT = { limit: 30, windowMs: 10 * 60 * 1000 };

export interface InboundSms {
  /** Provider message id: a repeat delivery of the same id is ignored. */
  providerMessageId: string;
  /** Normalized 2547…. */
  phone: string;
  text: string;
}

const t = (lang: Locale) => messages[lang].sms;

/** Process one inbound SMS. Returns the reply text (null for a duplicate). */
export async function handleInboundSms(
  ctx: AppContext,
  msg: InboundSms,
  log: FastifyBaseLogger,
): Promise<string | null> {
  const [user] = await ctx.db
    .select()
    .from(users)
    .where(and(eq(users.phone, msg.phone), isNull(users.deletedAt)))
    .limit(1);
  const command = parseSmsCommand(msg.text);
  const stored = await ctx.db
    .insert(smsInbound)
    .values({
      providerMessageId: msg.providerMessageId,
      phone: msg.phone,
      text: msg.text.slice(0, 1600),
      userId: user?.id ?? null,
      command: command.kind,
      receivedAt: ctx.clock(),
    })
    .onConflictDoNothing({ target: smsInbound.providerMessageId })
    .returning({ id: smsInbound.id });
  if (stored.length === 0) return null; // the provider resent it: already handled

  const lang: Locale = user?.language ?? 'sw';
  if (!user) return t(lang).unregistered;

  const hits = await ctx.counters.hit(`sms:${msg.phone}`, SMS_RATE_LIMIT.windowMs);
  if (hits > SMS_RATE_LIMIT.limit) return t(lang).tooMany;

  try {
    if (command.kind === 'rate') return await rate(ctx, user.id, command, lang);
    // Vet commands are for vets; anyone else gets the farmer help (USSD, rating).
    if (!user.roles.includes('vet')) return t(lang).helpFarmer;
    return await vetCommand(ctx, user.id, command, lang);
  } catch (err) {
    if (err instanceof DomainError) {
      if (err.code === 'vet_not_approved') return t(lang).notVerified;
      if (err.code === 'practice_incomplete') return t(lang).practiceIncomplete;
      if (err.code === 'already_rated') return interpolate(t(lang).rated, { ref: refOf(command) });
      if (err.code === 'offer_taken') return interpolate(t(lang).taken, { ref: refOf(command) });
      if (err.code === 'not_found') return interpolate(t(lang).noJob, { ref: refOf(command) });
      if (err.code === 'invalid_transition') {
        return interpolate(t(lang).invalidStep, { ref: refOf(command) });
      }
    }
    log.error({ err, phone: maskPhone(msg.phone), command: command.kind }, 'SMS command failed');
    return t(lang).error;
  }
}

const refOf = (c: SmsCommand) => ('bookingId' in c && c.bookingId !== null ? c.bookingId : '');

/** The job a command without a number means: the vet's only open offer or only active job. */
async function impliedJob(
  ctx: AppContext,
  vetId: string,
  kind: 'offer' | 'active',
): Promise<number | null> {
  if (kind === 'offer') {
    const open = await ctx.db
      .select({ bookingId: bookingOffers.bookingId })
      .from(bookingOffers)
      .innerJoin(bookings, eq(bookings.id, bookingOffers.bookingId))
      .where(
        and(
          eq(bookingOffers.vetId, vetId),
          eq(bookings.status, 'pending'),
          isNull(bookingOffers.response),
        ),
      )
      .limit(2);
    return open.length === 1 ? (open[0]?.bookingId ?? null) : null;
  }
  const active = await ctx.db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.vetId, vetId), inArray(bookings.status, ACTIVE_JOB_STATUSES)))
    .limit(2);
  return active.length === 1 ? (active[0]?.id ?? null) : null;
}

async function vetCommand(
  ctx: AppContext,
  vetId: string,
  command: SmsCommand,
  lang: Locale,
): Promise<string> {
  const vet = { userId: vetId, channel: 'sms' as const };
  switch (command.kind) {
    case 'help':
    case 'unknown':
      return t(lang).help;
    case 'online':
      await setAvailability(ctx, vetId, true); // re-checks approval (invariant 2)
      return t(lang).online;
    case 'offline':
      await setAvailability(ctx, vetId, false);
      return t(lang).offline;
    case 'accept':
    case 'decline': {
      // Gate before anything else: an unapproved vet gets the "not verified" reply (§8.3).
      const [me] = await ctx.db
        .select({ status: vets.verificationStatus })
        .from(vets)
        .where(eq(vets.userId, vetId));
      if (command.kind === 'accept' && me?.status !== 'approved') return t(lang).notVerified;
      const ref = command.bookingId ?? (await impliedJob(ctx, vetId, 'offer'));
      if (ref === null) {
        return interpolate(t(lang).needId, { cmd: command.kind === 'accept' ? 'Y' : 'N' });
      }
      const [offer] = await ctx.db
        .select({ id: bookingOffers.id })
        .from(bookingOffers)
        .where(and(eq(bookingOffers.bookingId, ref), eq(bookingOffers.vetId, vetId)))
        .limit(1);
      if (!offer) return interpolate(t(lang).noJob, { ref });
      if (command.kind === 'decline') {
        await declineOffer(ctx, { offerId: offer.id, bookingId: ref, vetId });
        return interpolate(t(lang).declined, { ref });
      }
      await acceptOffer(ctx, { offerId: offer.id, bookingId: ref, vetId, channel: 'sms' });
      return acceptedReply(ctx, ref, lang);
    }
    case 'en_route':
    case 'arrived': {
      const ref = command.bookingId ?? (await impliedJob(ctx, vetId, 'active'));
      if (ref === null) {
        return interpolate(t(lang).needId, { cmd: command.kind === 'en_route' ? 'OTW ' : 'ARR ' });
      }
      await vetStep(ctx, ref, command.kind === 'en_route' ? 'en_route' : 'in_service', vet);
      return interpolate(command.kind === 'en_route' ? t(lang).enRoute : t(lang).arrived, { ref });
    }
    case 'done': {
      const ref = command.bookingId ?? (await impliedJob(ctx, vetId, 'active'));
      if (ref === null) return interpolate(t(lang).needId, { cmd: 'DONE ' });
      const p = command.parsed;
      const followUpDate =
        p.followUpDays !== undefined
          ? new Date(ctx.clock().getTime() + p.followUpDays * 86_400_000).toISOString().slice(0, 10)
          : undefined;
      await completeByVet(ctx, ref, vet, {
        diagnosis: p.diagnosis,
        diagnosisCode: p.diagnosisCode,
        drugsUsed: p.drugs,
        // Never reject a completion because parsing failed: the raw text is the record.
        rawNotes: command.notes || '(no notes)',
        followUpDate,
      });
      return interpolate(t(lang).done, { ref });
    }
    case 'rate':
      return t(lang).help;
  }
}

/** After accepting: the farmer's contact and directions (contact is revealed only now, §17). */
async function acceptedReply(ctx: AppContext, bookingId: number, lang: Locale): Promise<string> {
  const [row] = await ctx.db
    .select({
      name: users.name,
      phone: users.phone,
      ward: locations.ward,
      notes: farmers.farmNotes,
    })
    .from(bookings)
    .innerJoin(users, eq(users.id, bookings.farmerId))
    .innerJoin(locations, eq(locations.id, bookings.wardId))
    .leftJoin(farmers, eq(farmers.userId, bookings.farmerId))
    .where(eq(bookings.id, bookingId));
  return interpolate(t(lang).accepted, {
    ref: bookingId,
    farmer: row?.name ?? '-',
    phone: row?.phone ?? '-',
    ward: row?.ward ?? '-',
    notes: row?.notes ? `${row.notes.slice(0, 60)}. ` : '',
  });
}

async function rate(
  ctx: AppContext,
  farmerId: string,
  command: Extract<SmsCommand, { kind: 'rate' }>,
  lang: Locale,
): Promise<string> {
  let ref = command.bookingId;
  if (ref === null) {
    // The farmer's latest finished, unrated visit.
    const [latest] = await ctx.db
      .select({ id: bookings.id })
      .from(bookings)
      .leftJoin(ratings, eq(ratings.bookingId, bookings.id))
      .where(and(eq(bookings.farmerId, farmerId), eq(bookings.status, 'done'), isNull(ratings.id)))
      .orderBy(desc(bookings.id))
      .limit(1);
    if (!latest) return t(lang).rateNone;
    ref = latest.id;
  }
  if (command.stars === null) return interpolate(t(lang).rateHow, { ref });
  await rateBooking(ctx, ref, farmerId, {
    stars: command.stars,
    ...(command.comment && { comment: command.comment }),
  });
  return interpolate(t(lang).rated, { ref });
}
