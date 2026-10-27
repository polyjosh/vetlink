import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { AppContext } from '../../context.js';
import {
  animals,
  bookings,
  locations,
  reminders,
  treatments,
  users,
  vets,
} from '../../db/schema/index.js';
import { notify } from '../notifications/service.js';
import { eatDate } from '../vets/insights.js';

/**
 * Daily reminders (§8.8): at 07:00 Nairobi time farmers hear about reminders due today and vets
 * about follow-ups today; at 18:00 vets hear about tomorrow's follow-ups (§24.4). Every send is
 * claimed first (a timestamp set only if still empty), so a rerun never sends twice.
 */
export async function sendFarmerReminders(
  ctx: AppContext,
  log: FastifyBaseLogger,
): Promise<number> {
  const today = eatDate(ctx.clock());
  const due = await ctx.db
    .select({ reminder: reminders, animal: animals })
    .from(reminders)
    .innerJoin(animals, eq(animals.id, reminders.animalId))
    .innerJoin(users, eq(users.id, animals.farmerId))
    .where(and(eq(reminders.dueDate, today), isNull(reminders.sentAt), isNull(users.deletedAt)));
  let sent = 0;
  for (const { reminder, animal } of due) {
    const [claimed] = await ctx.db
      .update(reminders)
      .set({ sentAt: ctx.clock() })
      .where(and(eq(reminders.id, reminder.id), isNull(reminders.sentAt)))
      .returning({ id: reminders.id });
    if (!claimed) continue;
    await notify(
      ctx,
      {
        userId: animal.farmerId,
        kind: 'reminder_due',
        params: { name: animal.nameOrTag ?? '' },
        localized: { animal: animal.species, reminderType: reminder.type },
        data: { animalId: animal.id },
      },
      log,
    );
    sent += 1;
  }
  return sent;
}

export async function sendVetFollowUpAlerts(
  ctx: AppContext,
  when: 'evening' | 'day',
  log: FastifyBaseLogger,
): Promise<number> {
  const now = ctx.clock();
  const date = eatDate(now, when === 'evening' ? 1 : 0);
  const column =
    when === 'evening' ? treatments.vetAlertEveningSentAt : treatments.vetAlertDaySentAt;
  const due = await ctx.db
    .select({
      treatmentId: treatments.id,
      bookingId: bookings.id,
      vetId: bookings.vetId,
      species: bookings.species,
      ward: locations.ward,
    })
    .from(treatments)
    .innerJoin(bookings, eq(bookings.id, treatments.bookingId))
    .innerJoin(vets, eq(vets.userId, bookings.vetId))
    .leftJoin(locations, eq(locations.id, bookings.wardId))
    .where(
      and(
        eq(treatments.followUpDate, date),
        isNull(treatments.followUpBookingId), // rebooked: the new booking takes over
        isNull(column),
        eq(vets.verificationStatus, 'approved'),
      ),
    );
  let sent = 0;
  for (const row of due) {
    if (!row.vetId) continue;
    const [claimed] = await ctx.db
      .update(treatments)
      .set(when === 'evening' ? { vetAlertEveningSentAt: now } : { vetAlertDaySentAt: now })
      .where(and(eq(treatments.id, row.treatmentId), isNull(column)))
      .returning({ id: treatments.id });
    if (!claimed) continue;
    await notify(
      ctx,
      {
        userId: row.vetId,
        kind: when === 'evening' ? 'followup_tomorrow' : 'followup_today',
        params: { ref: row.bookingId, ward: row.ward ?? '' },
        localized: { animal: row.species },
        data: { bookingId: row.bookingId },
      },
      log,
    );
    sent += 1;
  }
  return sent;
}

export async function morningReminders(ctx: AppContext, log: FastifyBaseLogger) {
  const farmers = await sendFarmerReminders(ctx, log);
  const vetAlerts = await sendVetFollowUpAlerts(ctx, 'day', log);
  log.info({ farmers, vetAlerts }, 'morning reminders sent');
}
