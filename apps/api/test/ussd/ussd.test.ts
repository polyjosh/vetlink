import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { messages, type Locale } from '@vetlink/i18n';
import type { FarmerBookingView } from '@vetlink/shared';
import {
  animals,
  bookings,
  farmers,
  locations,
  reminders,
  users,
} from '../../src/db/schema/index.js';
import { USSD_RATE_LIMIT } from '../../src/modules/ussd/routes.js';
import { Harness } from '../helpers/harness.js';
import {
  createTestDatabase,
  DB_SETUP_TIMEOUT_MS,
  testServerUrl,
  type TestDatabase,
} from '../helpers/test-db.js';

const SECRET = 'test-webhook-secret-0123456789';
const MAX_SCREEN = 160; // characters, including the CON/END prefix (§8.1)

describe.skipIf(!testServerUrl)('USSD (database)', { timeout: 60_000 }, () => {
  let tdb: TestDatabase;
  let h: Harness;
  const screensSeen: string[] = [];

  beforeAll(async () => {
    tdb = await createTestDatabase();
    // Wards to search for (one long name to test screen length).
    await tdb.handle.db.insert(locations).values([
      { county: 'Kiambu', subCounty: 'Githunguri', ward: 'Githunguri', lat: -1.05, lng: 36.77 },
      { county: 'Kiambu', subCounty: 'Githunguri', ward: 'Githiga', lat: -1.04, lng: 36.79 },
      { county: 'Kiambu', subCounty: 'Githunguri', ward: 'Ikinu', lat: -1.01, lng: 36.81 },
      { county: 'Kiambu', subCounty: 'Gatundu South', ward: 'Kiganjo', lat: -1.0, lng: 36.9 },
      {
        county: 'Kiambu',
        subCounty: 'Kiambu Township',
        ward: 'Township Ward Extra Long Name',
        lat: -1.17,
        lng: 36.83,
      },
    ]);
  }, DB_SETUP_TIMEOUT_MS);
  afterAll(async () => {
    // Every screen rendered in this file fits on a feature phone.
    for (const s of screensSeen) expect(s.length, s).toBeLessThanOrEqual(MAX_SCREEN);
    await tdb?.drop();
  }, DB_SETUP_TIMEOUT_MS);
  beforeEach(() => {
    h = new Harness(tdb, { webhookSecret: SECRET });
  });
  afterEach(async () => {
    await h.close();
  });

  /** One USSD request, as Africa's Talking would send it. */
  async function dial(phone: string, text: string, sessionId: string, token = SECRET) {
    const res = await h.app.inject({
      method: 'POST',
      url: `/webhooks/ussd?token=${token}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        sessionId,
        serviceCode: '*123#',
        phoneNumber: `+${phone}`,
        networkCode: '63902',
        text,
      }).toString(),
    });
    if (res.statusCode === 200) screensSeen.push(res.body);
    return res;
  }

  /** Walk a whole session: each step sends the history so far, like a real phone. */
  async function session(phone: string, steps: string[]) {
    const id = `ATUid_${randomUUID()}`;
    const screens = [(await dial(phone, '', id)).body];
    for (let i = 1; i <= steps.length; i++) {
      screens.push((await dial(phone, steps.slice(0, i).join('*'), id)).body);
    }
    return { id, screens, last: screens.at(-1) ?? '' };
  }

  async function wardId(name: string): Promise<number> {
    const [w] = await h.db.select().from(locations).where(eq(locations.ward, name));
    return w?.id ?? -1;
  }

  /** A consented farmer with a saved ward (a returning USSD user). */
  async function returningFarmer(lang: Locale = 'sw') {
    const phone = Harness.nextPhone();
    const [u] = await h.db
      .insert(users)
      .values({ phone, language: lang, roles: ['farmer'], consentAt: h.now })
      .returning({ id: users.id });
    await h.db.insert(farmers).values({ userId: u?.id ?? '', wardId: await wardId('Githunguri') });
    return { phone, userId: u?.id ?? '' };
  }

  const m = (lang: Locale) => messages[lang].ussd;

  describe.each<Locale>(['sw', 'en'])('new number, %s', (lang) => {
    const langKey = lang === 'sw' ? '1' : '2';

    it.each<[string, string[], (l: Locale) => string]>([
      ['first screen offers both languages', [], () => `CON ${m('sw').welcome}`],
      ['language → consent', [langKey], (l) => `CON ${m(l).consent}`],
      ['consent → main menu', [langKey, '1'], (l) => `CON ${m(l).mainMenu}`],
      ['decline consent → end', [langKey, '2'], (l) => `END ${m(l).consentDeclined}`],
      ['request → animal', [langKey, '1', '1'], (l) => `CON ${m(l).chooseAnimal}`],
      ['animal → problem', [langKey, '1', '1', '1'], (l) => `CON ${m(l).chooseProblem}`],
      ['no saved ward → ask ward', [langKey, '1', '1', '1', '1'], (l) => `CON ${m(l).enterWard}`],
      [
        'invalid choice → same screen',
        [langKey, '1', '9'],
        (l) => `CON ${m(l).invalid}\n${m(l).mainMenu}`,
      ],
    ])('%s', async (_name, steps, expected) => {
      const { last } = await session(Harness.nextPhone(), steps);
      expect(last).toBe(expected(lang));
    });

    it('books a vet end to end in the chosen language and saves the ward', async () => {
      const phone = Harness.nextPhone();
      // One session: language, consent, request, goat, injury, search "gith", pick, confirm.
      const { screens, last: done } = await session(phone, [
        langKey,
        '1',
        '1',
        '2',
        '2',
        'gith',
        '2',
        '1',
      ]);
      expect(screens[6]).toBe(
        `CON ${m(lang).chooseWard.replace('{options}', '1. Githiga (Githunguri)\n2. Githunguri')}`,
      );
      const confirm = screens[7] ?? '';
      expect(confirm).toContain(m(lang).species.goat);
      // No vet nearby in this test: the price is confirmed by the vet who accepts (§24.3).
      expect(confirm).toContain(m(lang).priceUnknown);
      expect(confirm).toContain('KES 200');
      expect(done).toMatch(/^END /);

      const [user] = await h.db.select().from(users).where(eq(users.phone, phone));
      expect(user).toMatchObject({ language: lang, roles: ['farmer'] });
      expect(user?.consentAt).not.toBeNull();
      const [booking] = await h.db
        .select()
        .from(bookings)
        .where(eq(bookings.farmerId, user?.id ?? ''));
      expect(booking).toMatchObject({
        sourceChannel: 'ussd',
        species: 'goat',
        problemType: 'injury',
        status: 'pending_payment',
        wardId: await wardId('Githunguri'),
        feeQuoted: 500,
      });
      expect(done).toBe(
        `END ${m(lang).requested.replace('{ref}', String(booking?.id)).replace('{deposit}', '200')}`,
      );
      const [farm] = await h.db
        .select()
        .from(farmers)
        .where(eq(farmers.userId, user?.id ?? ''));
      expect(farm?.wardId).toBe(await wardId('Githunguri'));
    });
  });

  describe('returning farmer', () => {
    it('skips language and consent; books in 5 taps with the saved ward', async () => {
      const f = await returningFarmer('en');
      const first = await session(f.phone, []);
      expect(first.last).toBe(`CON ${m('en').mainMenu}`);
      const location = await session(f.phone, ['1', '1', '1']);
      expect(location.last).toBe(`CON ${m('en').chooseLocation.replace('{ward}', 'Githunguri')}`);
      const done = await session(f.phone, ['1', '1', '1', '1', '1']);
      expect(done.last).toMatch(/^END Request \d+ sent/);
    });

    it('EMERGENCY NOW skips the location step and books an emergency', async () => {
      const f = await returningFarmer('sw');
      const confirm = await session(f.phone, ['1', '1', '5']);
      expect(confirm.last).toMatch(/^CON DHARURA: Ng'ombe\nWadi: Githunguri/);
      await session(f.phone, ['1', '1', '5', '1']);
      const [b] = await h.db.select().from(bookings).where(eq(bookings.farmerId, f.userId));
      expect(b).toMatchObject({ isEmergency: true, problemType: 'sick' });
    });

    it('a resent final request makes one booking, not two', async () => {
      const f = await returningFarmer('en');
      const { id } = await session(f.phone, ['1', '1', '1', '1', '1']);
      const again = await dial(f.phone, '1*1*1*1*1', id);
      expect(again.body).toMatch(/^END Request \d+ sent/);
      const rows = await h.db.select().from(bookings).where(eq(bookings.farmerId, f.userId));
      expect(rows).toHaveLength(1);
    });

    it('an unknown ward asks again; text at the ward list starts a new search', async () => {
      const f = await returningFarmer('en');
      const notFound = await session(f.phone, ['1', '1', '1', '2', 'zzz']);
      expect(notFound.last).toBe(`CON ${m('en').wardNotFound.replace('{query}', 'zzz')}`);
      const research = await session(f.phone, ['1', '1', '1', '2', 'githu', 'iki']);
      expect(research.last).toBe(
        `CON ${m('en').chooseWard.replace('{options}', '1. Ikinu (Githunguri)')}`,
      );
      const confirm = await session(f.phone, ['1', '1', '1', '2', 'githu', 'iki', '1']);
      expect(confirm.last).toContain('Ward: Ikinu');
    });

    it('cancel at the confirm screen books nothing', async () => {
      const f = await returningFarmer('en');
      const res = await session(f.phone, ['1', '1', '1', '1', '2']);
      expect(res.last).toBe(`END ${m('en').cancelled}`);
      expect(await h.db.select().from(bookings).where(eq(bookings.farmerId, f.userId))).toEqual([]);
    });

    it('lists and adds animals (once, even if the last request is resent)', async () => {
      const f = await returningFarmer('en');
      expect((await session(f.phone, ['2'])).last).toBe(`CON ${m('en').animalsEmpty}`);
      const { id, last } = await session(f.phone, ['2', '1', '3', 'Dolly']);
      expect(last).toBe(`END ${m('en').animalSaved.replace('{name}', 'Dolly')}`);
      await dial(f.phone, '2*1*3*Dolly', id);
      const rows = await h.db.select().from(animals).where(eq(animals.farmerId, f.userId));
      expect(rows).toMatchObject([{ species: 'sheep', nameOrTag: 'Dolly' }]);
      expect((await session(f.phone, ['2'])).last).toBe(
        `CON ${m('en').animalsList.replace('{list}', 'Dolly (Sheep)')}`,
      );
    });

    it('shows reminders and history', async () => {
      const f = await returningFarmer('en');
      expect((await session(f.phone, ['3'])).last).toBe(`END ${m('en').remindersEmpty}`);
      expect((await session(f.phone, ['4'])).last).toBe(`END ${m('en').historyEmpty}`);
      const [cow] = await h.db
        .insert(animals)
        .values({ farmerId: f.userId, species: 'cattle', nameOrTag: 'Daisy' })
        .returning({ id: animals.id });
      await h.db
        .insert(reminders)
        .values({ animalId: cow?.id ?? '', type: 'vaccine', dueDate: '2026-10-20' });
      expect((await session(f.phone, ['3'])).last).toBe('END Upcoming:\n20/10 Vaccine Daisy');
      await session(f.phone, ['1', '1', '1', '1', '1']);
      expect((await session(f.phone, ['4'])).last).toMatch(
        /^END Your last requests:\n#\d+ Cow 15\/10: Awaiting payment$/,
      );
    });
  });

  it('cross-channel: a USSD booking appears in the app for the same number and can be cancelled there', async () => {
    const phone = Harness.nextPhone();
    await session(phone, ['2', '1', '1', '1', '1', 'Ikinu', '1', '1']);
    const app = await h.login(phone);
    const list = (await h.get('/v1/bookings', app.accessToken)).json<FarmerBookingView[]>();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ sourceChannel: 'ussd', status: 'pending_payment' });
    const cancel = await h.post(
      `/v1/bookings/${list[0]?.id}/cancel`,
      { reason: 'changed_mind' },
      app.accessToken,
    );
    expect(cancel.json()).toMatchObject({ status: 'cancelled' });
  });

  it('rejects a missing or wrong webhook token', async () => {
    expect((await dial(Harness.nextPhone(), '', 'x1', 'wrong')).statusCode).toBe(404);
    expect((await dial(Harness.nextPhone(), '', 'x2', '')).statusCode).toBe(404);
  });

  it('rate-limits a flood from one number', async () => {
    const phone = Harness.nextPhone();
    for (let i = 0; i < USSD_RATE_LIMIT.limit; i++) await dial(phone, '', `flood-${i}`);
    expect((await dial(phone, '', 'flood-last')).body).toBe(`END ${m('sw').tooMany}`);
  });

  it('never logs the phone number or what was typed', async () => {
    const f = await returningFarmer('en');
    await session(f.phone, ['2', '1', '3', 'SecretName']);
    const out = h.logs.join('');
    expect(out).not.toContain(f.phone);
    expect(out).not.toContain('SecretName');
    expect(out).not.toContain(SECRET);
  });
});
