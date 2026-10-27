import { describe, expect, it } from 'vitest';
import { comingUp, dayBox, speciesCounts } from '@vetlink/shared';

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
