import { Hono } from 'hono';
import { eq, and, sql } from 'drizzle-orm';
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

  return router;
}
