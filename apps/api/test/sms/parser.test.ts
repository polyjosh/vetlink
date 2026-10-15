import { describe, expect, it } from 'vitest';
import { parseSmsCommand } from '../../src/modules/sms/parser.js';

/** The parsed notes of a DONE command. */
function doneNotes(text: string) {
  const c = parseSmsCommand(text);
  if (c.kind !== 'done') throw new Error(`expected done, got ${c.kind}`);
  return c.parsed;
}

describe('SMS command parser (§8.4)', () => {
  it.each([
    // accept: spacing, casing, separators, synonyms
    ['Y4821', { kind: 'accept', bookingId: 4821 }],
    ['y 4821', { kind: 'accept', bookingId: 4821 }],
    ['yes4821', { kind: 'accept', bookingId: 4821 }],
    ['  YES   4821  ', { kind: 'accept', bookingId: 4821 }],
    ['Y-4821', { kind: 'accept', bookingId: 4821 }],
    ['y#4821.', { kind: 'accept', bookingId: 4821 }],
    ['Accept 4821', { kind: 'accept', bookingId: 4821 }],
    ['ndio 4821', { kind: 'accept', bookingId: 4821 }],
    ['Y', { kind: 'accept', bookingId: null }],
    // decline
    ['N4821', { kind: 'decline', bookingId: 4821 }],
    ['no 4821', { kind: 'decline', bookingId: 4821 }],
    ['hapana 4821', { kind: 'decline', bookingId: 4821 }],
    // on the way / arrived
    ['OTW 4821', { kind: 'en_route', bookingId: 4821 }],
    ['otw4821', { kind: 'en_route', bookingId: 4821 }],
    ['on the way 4821', { kind: 'en_route', bookingId: 4821 }],
    ['On The Way', { kind: 'en_route', bookingId: null }],
    ['njiani 4821', { kind: 'en_route', bookingId: 4821 }],
    ['ARR 4821', { kind: 'arrived', bookingId: 4821 }],
    ['arrived', { kind: 'arrived', bookingId: null }],
    ['nimefika 4821', { kind: 'arrived', bookingId: 4821 }],
    // availability and help
    ['ON', { kind: 'online' }],
    ['on', { kind: 'online' }],
    ['OFF', { kind: 'offline' }],
    ['offline', { kind: 'offline' }],
    ['HELP', { kind: 'help' }],
    ['?', { kind: 'help' }],
    ['', { kind: 'help' }],
    ['msaada', { kind: 'help' }],
    // typos on longer words (one edit), never on short ones
    ['DOEN 4821 ECF', { kind: 'done', bookingId: 4821 }],
    ['DONEE 4821', { kind: 'done', bookingId: 4821 }],
    ['HLEP', { kind: 'help' }],
    ['ACCEP 4821', { kind: 'accept', bookingId: 4821 }],
    ['OF', { kind: 'unknown' }],
    ['X4821', { kind: 'unknown' }],
    ['hello vetlink', { kind: 'unknown' }],
    ['4821', { kind: 'unknown' }],
  ])('%j', (text, expected) => {
    expect(parseSmsCommand(text)).toMatchObject(expected);
  });

  it('parses DONE notes into diagnosis, code, drugs and follow-up', () => {
    expect(parseSmsCommand('DONE 4821 ECF; oxytet 20ml; f/u 7d')).toEqual({
      kind: 'done',
      bookingId: 4821,
      notes: 'ECF; oxytet 20ml; f/u 7d',
      parsed: { diagnosis: 'ECF', diagnosisCode: 'ecf', drugs: 'oxytet 20ml', followUpDays: 7 },
    });
    expect(doneNotes('done 4821 mastitis, penstrep 10ml, ivermectin; follow up 2 weeks')).toEqual({
      diagnosis: 'mastitis',
      diagnosisCode: 'mastitis',
      drugs: 'penstrep 10ml; ivermectin',
      followUpDays: 14,
    });
    expect(doneNotes('DONE 4821 East Coast Fever; fu 3')).toMatchObject({
      diagnosisCode: 'ecf',
      followUpDays: 3,
    });
  });

  it('never rejects a completion: unparseable notes are kept raw', () => {
    const c = parseSmsCommand('DONE 4821 cow fine now, gave 1.5 ml stuff');
    expect(c).toMatchObject({
      kind: 'done',
      bookingId: 4821,
      notes: 'cow fine now, gave 1.5 ml stuff',
    });
    if (c.kind !== 'done') throw new Error('expected done');
    expect(c.parsed.diagnosisCode).toBeUndefined();
    expect(parseSmsCommand('done')).toMatchObject({ kind: 'done', bookingId: null, notes: '' });
  });

  it('parses ratings: R<id> <1-5> [comment]', () => {
    expect(parseSmsCommand('R4821 5')).toEqual({
      kind: 'rate',
      bookingId: 4821,
      stars: 5,
      comment: '',
    });
    expect(parseSmsCommand('r 4821 4 very good vet')).toEqual({
      kind: 'rate',
      bookingId: 4821,
      stars: 4,
      comment: 'very good vet',
    });
    expect(parseSmsCommand('R4821 9')).toMatchObject({ kind: 'rate', stars: null });
    expect(parseSmsCommand('rate')).toMatchObject({ kind: 'rate', bookingId: null, stars: null });
  });
});
