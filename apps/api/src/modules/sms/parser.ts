/**
 * Parser for SMS commands (§8.4). Pure and forgiving: case, spacing, punctuation, Swahili
 * synonyms and one-letter typos in longer words are all accepted. It never rejects a
 * completion: whatever follows `DONE` is kept as notes even when nothing in it parses.
 */

export type SmsCommand =
  | { kind: 'accept'; bookingId: number | null }
  | { kind: 'decline'; bookingId: number | null }
  | { kind: 'en_route'; bookingId: number | null }
  | { kind: 'arrived'; bookingId: number | null }
  | { kind: 'done'; bookingId: number | null; notes: string; parsed: DoneNotes }
  | { kind: 'online' }
  | { kind: 'offline' }
  | { kind: 'help' }
  | { kind: 'rate'; bookingId: number | null; stars: number | null; comment: string }
  | { kind: 'unknown' };

export interface DoneNotes {
  diagnosis?: string;
  /** Normalized for outbreak counts (§8.9), only for recognized conditions. */
  diagnosisCode?: string;
  drugs?: string;
  followUpDays?: number;
}

type Kind = Exclude<SmsCommand['kind'], 'unknown'>;

const KEYWORDS: Record<string, Kind> = {
  Y: 'accept',
  YES: 'accept',
  YS: 'accept',
  ACCEPT: 'accept',
  NDIO: 'accept',
  KUBALI: 'accept',
  N: 'decline',
  NO: 'decline',
  DECLINE: 'decline',
  HAPANA: 'decline',
  KATAA: 'decline',
  OTW: 'en_route',
  ONTHEWAY: 'en_route',
  ENROUTE: 'en_route',
  NJIANI: 'en_route',
  ARR: 'arrived',
  ARRIVED: 'arrived',
  NIMEFIKA: 'arrived',
  FIKA: 'arrived',
  DONE: 'done',
  COMPLETE: 'done',
  COMPLETED: 'done',
  IMEKAMILIKA: 'done',
  MALIZA: 'done',
  ON: 'online',
  ONLINE: 'online',
  OFF: 'offline',
  OFFLINE: 'offline',
  HELP: 'help',
  MSAADA: 'help',
  '?': 'help',
  R: 'rate',
  RATE: 'rate',
};

/** Conditions with a normalized code (start with the notifiable and the common ones). */
const DIAGNOSES: Record<string, string> = {
  ECF: 'ecf',
  'EAST COAST FEVER': 'ecf',
  FMD: 'fmd',
  'FOOT AND MOUTH': 'fmd',
  LSD: 'lsd',
  'LUMPY SKIN': 'lsd',
  MASTITIS: 'mastitis',
  ANTHRAX: 'anthrax',
  RABIES: 'rabies',
  PPR: 'ppr',
  CCPP: 'ccpp',
  CBPP: 'cbpp',
  NEWCASTLE: 'newcastle',
  NCD: 'newcastle',
  ASF: 'asf',
  'AFRICAN SWINE FEVER': 'asf',
  'BLACK QUARTER': 'black_quarter',
  BQ: 'black_quarter',
  ANAPLASMOSIS: 'anaplasmosis',
  BABESIOSIS: 'babesiosis',
  PNEUMONIA: 'pneumonia',
  'MILK FEVER': 'milk_fever',
  BLOAT: 'bloat',
  WORMS: 'worms',
  DIARRHOEA: 'diarrhoea',
  DIARRHEA: 'diarrhoea',
};

function distance1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else if (a[i] === b[j + 1] && a[i + 1] === b[j]) {
      // transposition ("DOEN")
      i += 2;
      j += 2;
    } else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function keywordKind(word: string): Kind | null {
  const exact = KEYWORDS[word];
  if (exact) return exact;
  // Typos only on longer words: short ones (Y, N, ON, OFF, ARR) are too easy to confuse.
  if (word.length < 4) return null;
  for (const [k, kind] of Object.entries(KEYWORDS)) {
    if (k.length >= 4 && distance1(word, k)) return kind;
  }
  return null;
}

function parseDone(notes: string): DoneNotes {
  const parts = notes
    .split(/[;\n]|,(?!\d)/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: DoneNotes = {};
  const drugs: string[] = [];
  for (const part of parts) {
    const fu =
      /\b(?:f\/?u|follow[\s-]?up|fu|rudi)\s*(?:in\s*)?(\d{1,3})\s*(d|days?|w|wks?|weeks?|siku|wiki)?\b/i.exec(
        part,
      );
    if (fu) {
      const n = Number(fu[1]);
      const unit = (fu[2] ?? 'd').toLowerCase();
      out.followUpDays = /^(w|wk|wks|week|weeks|wiki)$/.test(unit) ? n * 7 : n;
      continue;
    }
    if (out.diagnosis === undefined) {
      out.diagnosis = part.slice(0, 200);
      const key = part
        .toUpperCase()
        .replace(/[^A-Z ]/g, '')
        .trim();
      const code = DIAGNOSES[key];
      if (code) out.diagnosisCode = code;
      continue;
    }
    drugs.push(part);
  }
  if (drugs.length) out.drugs = drugs.join('; ').slice(0, 500);
  return out;
}

export function parseSmsCommand(text: string): SmsCommand {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean === '') return { kind: 'help' };
  // "ON THE WAY 4821" and "on the way" read as one keyword.
  const phrase = /^on\s*the\s*way\b(.*)$/i.exec(clean);
  const head = phrase ? `ONTHEWAY${phrase[1] ?? ''}` : clean;
  const m = /^([A-Za-z?]+)[\s\-#:.,]*(\d{1,9})?[\s\-#:.,]*(.*)$/s.exec(head);
  if (!m) return { kind: 'unknown' };
  const kind = keywordKind((m[1] ?? '').toUpperCase());
  if (!kind) return { kind: 'unknown' };
  const bookingId = m[2] ? Number(m[2]) : null;
  const rest = (m[3] ?? '').trim();
  switch (kind) {
    case 'accept':
    case 'decline':
    case 'en_route':
    case 'arrived':
      return { kind, bookingId };
    case 'done':
      return { kind, bookingId, notes: rest, parsed: parseDone(rest) };
    case 'rate': {
      const stars = /^([1-5])\b(.*)$/s.exec(rest);
      return {
        kind,
        bookingId,
        stars: stars ? Number(stars[1]) : null,
        comment: (stars?.[2] ?? '').trim().slice(0, 500),
      };
    }
    default:
      return { kind };
  }
}
