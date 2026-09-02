// Scheduled (cron) job: daily auto-status transitions + automatic late fees.
// Runs at 01:00 UTC (= 08:00 WIB) via wrangler [triggers] crons.
//
// Logic (WIB-aware, idempotent — safe to run multiple times):
//   - Confirmed  & startDate <= today        -> Active
//   - Active    & endDate   <  today         -> Completed, actualReturnDate = endDate,
//                                               lateFee = daysOverdue * late_fee_per_day
//   - Laptops with zero remaining active bookings -> Available (respects quantity)
//
// Date comparisons use YYYY-MM-DD strings (lexicographic == chronological),
// with "today" computed in WIB (UTC+7).

import { eq, and, sql } from 'drizzle-orm';
import { createDb } from '../db';
import { bookings, laptops, systemConfig } from '../db/schema';
import { ACTIVE_BOOKING_STATUSES, daysBetween } from './booking';
import type { Env } from '../env';

function todayWIB(): string {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().slice(0, 10);
}

function addDaysWIB(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function getConfigNumber(
  db: ReturnType<typeof createDb>,
  key: string,
  fallback: number,
): Promise<number> {
  const row = await db
    .select({ value: systemConfig.value })
    .from(systemConfig)
    .where(eq(systemConfig.key, key))
    .limit(1);
  const n = row[0]?.value != null ? Number(row[0].value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

// Recompute a laptop's availability from its active-booking count vs quantity.
// Only overrides Available/Rented; leaves manual Maintenance/Inactive untouched.
async function recomputeLaptop(db: ReturnType<typeof createDb>, laptopId: string) {
  const [laptop] = await db
    .select({ quantity: laptops.quantity, status: laptops.status })
    .from(laptops)
    .where(eq(laptops.id, laptopId))
    .limit(1);
  if (!laptop) return;
  if (laptop.status === 'Maintenance' || laptop.status === 'Inactive') return;
  const statusIn = `('${ACTIVE_BOOKING_STATUSES.join("', '")}')`;
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(bookings)
    .where(and(eq(bookings.laptopId, laptopId), sql`${bookings.status} IN ${sql.raw(statusIn)}`));
  const next = (count ?? 0) >= (laptop.quantity ?? 1) ? 'Rented' : 'Available';
  await db
    .update(laptops)
    .set({ status: next as never, updatedAt: new Date().toISOString() })
    .where(eq(laptops.id, laptopId));
}

export interface CronSummary {
  confirmedToActive: number;
  activeToCompleted: number;
  lateFeesApplied: number;
  laptopsRecomputed: number;
  expiredBookings: number;
  overdueWarnings: number;
}

export async function runCron(env: Env): Promise<CronSummary> {
  const db = createDb(env.DB);
  const today = todayWIB();
  const lateFeePerDay = await getConfigNumber(db, 'late_fee_per_day', 25000);

  const summary: CronSummary = {
    confirmedToActive: 0,
    activeToCompleted: 0,
    lateFeesApplied: 0,
    laptopsRecomputed: 0,
    expiredBookings: 0,
    overdueWarnings: 0,
  };

  // 0) Expire stale unpaid bookings: Pending/pending_payment older than 24h.
  const staleCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const stale = await db
    .select()
    .from(bookings)
    .where(
      and(
        sql`${bookings.status} IN ('Pending', 'pending_payment')`,
        sql`${bookings.createdAt} < ${staleCutoff}`,
      ),
    );
  for (const b of stale) {
    await db
      .update(bookings)
      .set({ status: 'expired', updatedAt: new Date().toISOString() })
      .where(eq(bookings.id, b.id));
    summary.expiredBookings += 1;
  }

  // 1) Confirmed -> Active when the rental period has started.
  const confirmed = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.status, 'Confirmed'), sql`${bookings.startDate} <= ${today}`));
  for (const b of confirmed) {
    await db
      .update(bookings)
      .set({ status: 'Active', updatedAt: new Date().toISOString() })
      .where(eq(bookings.id, b.id));
    summary.confirmedToActive += 1;
  }

  // 2) Active -> Completed when endDate has passed. Charge late fee for overdue days.
  const active = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.status, 'Active'), sql`${bookings.endDate} < ${today}`));
  const affectedLaptops = new Set<string>();
  for (const b of active) {
    const daysOverdue = Math.max(0, daysBetween(b.endDate, today));
    const lateFee = daysOverdue * lateFeePerDay;
    const damageFee = b.damageFee ?? 0;
    const totalPenalty = lateFee + damageFee;
    await db
      .update(bookings)
      .set({
        status: 'Completed',
        actualReturnDate: b.endDate,
        lateFee,
        totalPenalty,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(bookings.id, b.id));
    summary.activeToCompleted += 1;
    if (lateFee > 0) summary.lateFeesApplied += 1;
    if (b.laptopId) affectedLaptops.add(b.laptopId);
  }

  // 2b) Overdue warning (H-1): Active bookings ending tomorrow. Log + annotate
  // notes as prep for future WA/email notifications.
  const tomorrow = addDaysWIB(today, 1);
  const dueTomorrow = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.status, 'Active'), eq(bookings.endDate, tomorrow)));
  for (const b of dueTomorrow) {
    const warning = `[overdue-warning] Rental jatuh tempo ${b.endDate}`;
    await db
      .update(bookings)
      .set({
        notes: b.notes ? `${b.notes}\n${warning}` : warning,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(bookings.id, b.id));
    console.log(`[cron] overdue-warning booking ${b.bookingNumber} due ${b.endDate}`);
    summary.overdueWarnings += 1;
  }

  // 3) Recompute laptop availability for laptops whose bookings changed.
  for (const laptopId of affectedLaptops) {
    await recomputeLaptop(db, laptopId);
    summary.laptopsRecomputed += 1;
  }

  console.log(`[cron] auto-status summary ${JSON.stringify(summary)} (today WIB=${today})`);
  return summary;
}
