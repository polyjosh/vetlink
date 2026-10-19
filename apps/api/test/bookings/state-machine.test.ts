import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BOOKING_ACTOR_KINDS,
  BOOKING_EVENTS,
  BOOKING_STATUSES,
  BOOKING_TRANSITIONS,
  TERMINAL_BOOKING_STATUSES,
  availableEvents,
  canTransition,
  transitionTarget,
} from '@vetlink/shared';

describe('booking state machine (table)', () => {
  it('follows the §9 happy path', () => {
    const path = [
      ['pending_payment', 'deposit_confirmed', 'system', 'pending'],
      ['pending', 'vet_accepted', 'vet', 'matched'],
      ['matched', 'vet_en_route', 'vet', 'en_route'],
      ['en_route', 'vet_arrived', 'vet', 'in_service'],
      ['in_service', 'vet_completed', 'vet', 'done'],
    ] as const;
    for (const [from, event, actor, to] of path) {
      expect(canTransition(from, event, actor)).toBe(true);
      expect(BOOKING_TRANSITIONS[event].to).toBe(to);
    }
  });

  it('allows nothing out of a terminal status', () => {
    for (const status of TERMINAL_BOOKING_STATUSES) {
      for (const actor of BOOKING_ACTOR_KINDS) expect(availableEvents(status, actor)).toEqual([]);
    }
  });

  it('only the system confirms or fails payment; only vets move the job forward', () => {
    for (const actor of BOOKING_ACTOR_KINDS) {
      for (const status of BOOKING_STATUSES) {
        expect(canTransition(status, 'deposit_confirmed', actor)).toBe(
          actor === 'system' && (status === 'pending_payment' || status === 'awaiting_deposit'),
        );
        for (const e of ['vet_accepted', 'vet_en_route', 'vet_arrived', 'vet_completed'] as const) {
          if (canTransition(status, e, actor)) expect(actor).toBe('vet');
        }
      }
    }
  });

  it('the chosen-vet flow (§24.20): one event, two targets; the farmer chooses again', () => {
    expect(transitionTarget('vet_accepted', 'pending')).toBe('matched');
    expect(transitionTarget('vet_accepted', 'requested')).toBe('awaiting_deposit');
    expect(transitionTarget('deposit_confirmed', 'pending_payment')).toBe('pending');
    expect(transitionTarget('deposit_confirmed', 'awaiting_deposit')).toBe('matched');
    expect(canTransition('requested', 'vet_declined_request', 'vet')).toBe(true);
    expect(canTransition('vet_unavailable', 'farmer_rechose', 'farmer')).toBe(true);
    expect(canTransition('vet_unavailable', 'farmer_switched_to_auto', 'farmer')).toBe(true);
    expect(canTransition('requested', 'request_timed_out', 'farmer')).toBe(false);
    expect(canTransition('awaiting_deposit', 'deposit_timed_out', 'system')).toBe(true);
    // Nothing was paid before acceptance, so the farmer may always walk away.
    for (const s of ['requested', 'vet_unavailable', 'awaiting_deposit'] as const) {
      expect(canTransition(s, 'farmer_cancelled', 'farmer')).toBe(true);
    }
  });

  it('a farmer cannot cancel once the vet is with the animal', () => {
    expect(canTransition('en_route', 'farmer_cancelled', 'farmer')).toBe(true);
    expect(canTransition('in_service', 'farmer_cancelled', 'farmer')).toBe(false);
    expect(canTransition('in_service', 'admin_cancelled', 'admin')).toBe(true);
  });

  it('defines a rule for every event, each with a valid target', () => {
    expect(Object.keys(BOOKING_TRANSITIONS).sort()).toEqual([...BOOKING_EVENTS].sort());
    for (const rule of Object.values(BOOKING_TRANSITIONS)) {
      expect(BOOKING_STATUSES).toContain(rule.to);
      for (const [from, to] of Object.entries(rule.toFrom ?? {})) {
        expect(rule.from).toContain(from);
        expect(BOOKING_STATUSES).toContain(to);
      }
      expect(rule.from.length).toBeGreaterThan(0);
    }
  });
});

describe('invariant 3: booking status is written only by transitions.ts', () => {
  const srcDir = new URL('../../src/', import.meta.url).pathname;
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
    });

  it('no other source file updates the bookings table', () => {
    const offenders = files(srcDir).filter((path) => {
      if (path.endsWith('modules/bookings/transitions.ts')) return false;
      const text = readFileSync(path, 'utf8');
      return /\.update\(\s*bookings\s*\)/.test(text) || /update\s+"?bookings"?\s+set/i.test(text);
    });
    expect(offenders).toEqual([]);
  });
});
