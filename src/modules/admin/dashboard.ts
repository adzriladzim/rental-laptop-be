import { Hono } from 'hono';
import { eq, and, sql, gte, lte } from 'drizzle-orm';
import { createDb } from '../../db';
import { laptops, bookings, leads, customers, payments } from '../../db/schema';
import type { AppEnv } from '../../env';

export function createDashboardRouter(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/overview', async (c) => {
    const db = createDb(c.env.DB);
    const [
      totalLaptops,
      availableLaptops,
      activeBookings,
      pendingLeads,
      totalCustomers,
      revenue,
    ] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(laptops),
      db.select({ count: sql<number>`count(*)` }).from(laptops).where(eq(laptops.status, 'Available')),
      db.select({ count: sql<number>`count(*)` }).from(bookings).where(sql`${bookings.status} IN ('Confirmed','Active')`),
      db.select({ count: sql<number>`count(*)` }).from(leads).where(eq(leads.status, 'New')),
      db.select({ count: sql<number>`count(*)` }).from(customers),
      db.select({ total: sql<number>`coalesce(sum(${payments.amount}),0)` }).from(payments).where(eq(payments.status, 'verified')),
    ]);

    return c.json({
      data: {
        totalLaptops: totalLaptops[0]?.count ?? 0,
        availableLaptops: availableLaptops[0]?.count ?? 0,
        activeBookings: activeBookings[0]?.count ?? 0,
        pendingLeads: pendingLeads[0]?.count ?? 0,
        totalCustomers: totalCustomers[0]?.count ?? 0,
        revenue: revenue[0]?.total ?? 0,
        currency: 'IDR',
      },
    });
  });

  router.get('/trends', async (c) => {
    const days = Math.min(90, Math.max(1, parseInt(c.req.query('days') ?? '30', 10) || 30));
    const db = createDb(c.env.DB);
    const start = new Date();
    start.setUTCDate(start.getUTCDate() - (days - 1));
    const startISO = start.toISOString().slice(0, 10);

    const [revenueRows, bookingRows] = await Promise.all([
      db
        .select({
          day: sql<string>`substr(${payments.verifiedAt}, 1, 10)`,
          total: sql<number>`sum(${payments.amount})`,
        })
        .from(payments)
        .where(and(eq(payments.status, 'verified'), gte(payments.verifiedAt, startISO)))
        .groupBy(sql`substr(${payments.verifiedAt}, 1, 10)`),
      db
        .select({
          day: sql<string>`substr(${bookings.createdAt}, 1, 10)`,
          count: sql<number>`count(*)`,
        })
        .from(bookings)
        .where(gte(bookings.createdAt, startISO))
        .groupBy(sql`substr(${bookings.createdAt}, 1, 10)`),
    ]);

    // Build contiguous day series (no gaps).
    const revenueMap = new Map(revenueRows.map((r) => [r.day, r.total ?? 0]));
    const bookingMap = new Map(bookingRows.map((r) => [r.day, r.count ?? 0]));
    const series: { date: string; revenue: number; bookings: number }[] = [];
    const cur = new Date(`${startISO}T00:00:00Z`);
    for (let i = 0; i < days; i++) {
      const date = cur.toISOString().slice(0, 10);
      series.push({
        date,
        revenue: revenueMap.get(date) ?? 0,
        bookings: bookingMap.get(date) ?? 0,
      });
      cur.setUTCDate(cur.getUTCDate() + 1);
    }

    const [statusRows, laptopStatusRows] = await Promise.all([
      db
        .select({ status: bookings.status, count: sql<number>`count(*)` })
        .from(bookings)
        .groupBy(bookings.status),
      db
        .select({ status: laptops.status, count: sql<number>`count(*)` })
        .from(laptops)
        .groupBy(laptops.status),
    ]);

    const bookingStatusCounts: Record<string, number> = {};
    for (const r of statusRows) bookingStatusCounts[r.status] = r.count ?? 0;
    const laptopUtilization: Record<string, number> = {};
    for (const r of laptopStatusRows) laptopUtilization[r.status] = r.count ?? 0;

    return c.json({
      data: { series, bookingStatusCounts, laptopUtilization },
    });
  });

  return router;
}
