import { describe, expect, it } from 'vitest';
import {
  applicationChecklist,
  comingUp,
  dayBox,
  speciesCounts,
  trackingSteps,
} from '@vetlink/shared';

const base = {
  species: 'cattle',
  problemType: 'sick',
  scheduledFor: null,
  vet: null,
  requestedVet: null,
  treatment: null,
} as const;

describe('farmer home views', () => {
  const now = new Date('2026-10-27T09:00:00Z');

  it('lists open scheduled visits and unbooked follow-ups, soonest first', () => {
    const items = comingUp(
      [
        { ...base, id: 1, status: 'requested', scheduledFor: '2026-11-03T05:00:00Z' },
        { ...base, id: 2, status: 'cancelled', scheduledFor: '2026-11-01T05:00:00Z' },
        {
          ...base,
          id: 3,
          status: 'done',
          vet: { name: 'Otieno A.' },
          treatment: { followUpDate: '2026-10-30', followUpBookingId: null },
        },
        {
          ...base,
          id: 4,
          status: 'done',
          treatment: { followUpDate: '2026-10-29', followUpBookingId: 9 },
        },
        {
          ...base,
          id: 5,
          status: 'done',
          treatment: { followUpDate: '2026-10-20', followUpBookingId: null },
        },
      ],
      now,
    );
    expect(items.map((i) => [i.kind, i.bookingId, i.vetName])).toEqual([
      ['follow_up', 3, 'Otieno A.'],
      ['visit', 1, null],
    ]);
  });

  it('counts animals per species, largest first', () => {
    expect(
      speciesCounts([{ species: 'goat' }, { species: 'cattle' }, { species: 'goat' }]),
    ).toEqual([
      { species: 'goat', count: 2 },
      { species: 'cattle', count: 1 },
    ]);
  });

  it('shows the Nairobi date of an instant', () => {
    // 22:30 UTC on 2 Nov is 01:30 on 3 Nov in Nairobi.
    expect(dayBox('2026-11-02T22:30:00Z', 'en')).toEqual({ month: 'NOV', day: '03' });
    expect(dayBox('2026-11-18', 'en')).toEqual({ month: 'NOV', day: '18' });
  });
});

describe('tracking steps', () => {
  const at = '2026-10-27T09:00:00Z';
  const states = (status: Parameters<typeof trackingSteps>[0]['status']) =>
    trackingSteps({ status, createdAt: at, timeline: [{ status: 'matched', at }] }).map(
      (s) => s.state,
    );

  it('marks the step the booking is on', () => {
    expect(states('requested')).toEqual([
      'current',
      'upcoming',
      'upcoming',
      'upcoming',
      'upcoming',
    ]);
    expect(states('en_route')).toEqual(['done', 'done', 'current', 'upcoming', 'upcoming']);
    expect(states('done')).toEqual(['done', 'done', 'done', 'done', 'done']);
  });

  it('has no current step once a request ended', () => {
    expect(states('cancelled')).toEqual([
      'upcoming',
      'upcoming',
      'upcoming',
      'upcoming',
      'upcoming',
    ]);
  });

  it('dates each reached step from the timeline', () => {
    const steps = trackingSteps({
      status: 'matched',
      createdAt: at,
      timeline: [{ status: 'matched', at }],
    });
    expect(steps.map((s) => s.at)).toEqual([at, at, null, null, null]);
  });
});

describe('application checklist', () => {
  it('flags what the reviewer named and accepts the rest once decided', () => {
    const items = applicationChecklist({
      status: 'changes_requested',
      flaggedFields: ['personal.fullName', 'doc.id_front'],
      documents: [
        { kind: 'id_front', status: 'uploaded', flagReason: 'Blurry' },
        { kind: 'licence', status: 'accepted', flagReason: null },
      ],
    });
    const state = (k: string) =>
      items.find((i) => (i.kind === 'step' ? i.step : i.doc) === k)?.state;
    expect(state('personal')).toBe('flagged');
    expect(state('credentials')).toBe('accepted');
    expect(state('id_front')).toBe('flagged');
    expect(state('licence')).toBe('accepted');
    expect(items.some((i) => i.kind === 'step' && i.step === 'declaration')).toBe(false);
  });

  it('shows everything as being checked before a decision', () => {
    const items = applicationChecklist({
      status: 'under_review',
      flaggedFields: [],
      documents: [{ kind: 'licence', status: 'uploaded', flagReason: null }],
    });
    expect(new Set(items.map((i) => i.state))).toEqual(new Set(['in_review']));
  });
});
