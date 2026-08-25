import { sql, and } from 'drizzle-orm';
import { createDb } from '../db';
import { bookings, maintenanceRecords, laptops } from '../db/schema';

export const ACTIVE_BOOKING_STATUSES = ['Pending', 'pending_payment', 'Confirmed', 'Active'];

export function daysBetween(start: string, end: string): number {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return 0;
  return Math.max(1, Math.ceil((e - s) / 86_400_000));
}

// Real pricelist (uniform all units, from @sewaintop):
// 175k/day (1-2d) · 160k/day (3-6d) · weekly 875k => 125k/day (7-29d) · monthly 2400k => 80k/day (30d+)
const THREE_PLUS_DAY_RATE = 160_000;

export function calcTotal(
  days: number,
  daily?: number | null,
  weekly?: number | null,
  monthly?: number | null,
): number {
  if (monthly && days >= 30) return Math.round((monthly / 30) * days);
  if (weekly && days >= 7) return Math.round((weekly / 7) * days);
  if (days >= 3) return days * THREE_PLUS_DAY_RATE;
  return (daily ?? 0) * days;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Laptops blocked by overlapping maintenance:
//  - InProgress (startedAt set): blocked from startedAt date indefinitely (until completed).
//  - Pending/Scheduled (scheduledDate set, not started): blocked on scheduledDate ±1 day.
export async function maintenanceBlockedLaptopIds(
  db: ReturnType<typeof createDb>,
  start: string,
  end: string,
): Promise<string[]> {
  const rows = await db
    .select()
    .from(maintenanceRecords)
    .where(sql`${maintenanceRecords.status} IN ('Pending','InProgress')`);
  const blocked = new Set<string>();
  for (const mr of rows) {
    if (mr.status === 'InProgress' && mr.startedAt) {
      const startedDate = mr.startedAt.slice(0, 10);
      if (end > startedDate) blocked.add(mr.laptopId);
    } else if (mr.status === 'Pending' && mr.scheduledDate) {
      const sched = mr.scheduledDate.slice(0, 10);
      const windowStart = addDays(sched, -1);
      const windowEnd = addDays(sched, 2); // exclusive (+1 day inclusive)
      if (start < windowEnd && end > windowStart) blocked.add(mr.laptopId);
    }
  }
  return [...blocked];
}

// Count overlapping ACTIVE bookings per laptop for a date range [start, end).
export async function overlapCounts(
  db: ReturnType<typeof createDb>,
  start: string,
  end: string,
): Promise<Map<string, number>> {
  const statusIn = `('${ACTIVE_BOOKING_STATUSES.join("', '")}')`;
  const rows = await db
    .select({ laptopId: bookings.laptopId, count: sql<number>`count(*)` })
    .from(bookings)
    .where(
      and(
        sql`${bookings.status} IN ${sql.raw(statusIn)}`,
        sql`${bookings.startDate} < ${end} AND ${bookings.endDate} > ${start}`,
      ),
    )
    .groupBy(bookings.laptopId);
  return new Map(rows.map((r) => [r.laptopId, Number(r.count)]));
}

// Laptops that are FULLY booked (overlap count >= quantity) OR maintenance-blocked.
export async function unavailableLaptopIds(
  db: ReturnType<typeof createDb>,
  start: string,
  end: string,
): Promise<string[]> {
  const counts = await overlapCounts(db, start, end);
  const laptopRows = await db
    .select({ id: laptops.id, quantity: laptops.quantity })
    .from(laptops);
  const qtyMap = new Map(laptopRows.map((l) => [l.id, l.quantity ?? 1]));
  const unavailable = new Set<string>();
  for (const [laptopId, count] of counts) {
    const qty = qtyMap.get(laptopId) ?? 1;
    if (count >= qty) unavailable.add(laptopId);
  }
  const maintenance = await maintenanceBlockedLaptopIds(db, start, end);
  for (const m of maintenance) unavailable.add(m);
  return [...unavailable];
}

export async function generateBookingNumber(db: ReturnType<typeof createDb>): Promise<string> {
  const year = new Date().getFullYear();
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(bookings)
    .where(sql`${bookings.bookingNumber} LIKE ${`LPR-${year}-%`}`);
  return `LPR-${year}-${String((count ?? 0) + 1).padStart(4, '0')}`;
}
