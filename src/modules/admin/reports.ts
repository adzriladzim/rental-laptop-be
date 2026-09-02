import { Hono } from 'hono';
import { eq, and, desc, isNotNull, gte, lte, sql } from 'drizzle-orm';
import { createDb } from '../../db';
import { customers, bookings, laptops, payments } from '../../db/schema';
import { parsePagination, listResponse } from '../../lib/pagination';
import type { AppEnv } from '../../env';

export function createReportsRouter(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  // GET /reports/revenue?start=YYYY-MM-DD&end=YYYY-MM-DD
  router.get('/revenue', async (c) => {
    const start = c.req.query('start') ?? '2026-01-01';
    const end = c.req.query('end') ?? '2026-12-31';
    const db = createDb(c.env.DB);

    const rows = await db
      .select({
        date: sql<string>`date(${bookings.createdAt})`,
        count: sql<number>`count(*)`,
        revenue: sql<number>`coalesce(sum(${bookings.totalAmount}), 0)`,
      })
      .from(bookings)
      .where(and(gte(bookings.createdAt, start), lte(bookings.createdAt, end + 'T23:59:59')))
      .groupBy(sql`date(${bookings.createdAt})`)
      .orderBy(sql`date(${bookings.createdAt})`);

    return c.json({ data: rows });
  });

  // GET /reports/bookings?start=YYYY-MM-DD&end=YYYY-MM-DD
  router.get('/bookings', async (c) => {
    const start = c.req.query('start') ?? '2026-01-01';
    const end = c.req.query('end') ?? '2026-12-31';
    const db = createDb(c.env.DB);

    const rows = await db
      .select({
        status: bookings.status,
        count: sql<number>`count(*)`,
        totalAmount: sql<number>`coalesce(sum(${bookings.totalAmount}), 0)`,
      })
      .from(bookings)
      .where(and(gte(bookings.createdAt, start), lte(bookings.createdAt, end + 'T23:59:59')))
      .groupBy(bookings.status);

    return c.json({ data: rows });
  });

  // GET /reports/fleet?start=YYYY-MM-DD&end=YYYY-MM-DD
  router.get('/fleet', async (c) => {
    const start = c.req.query('start') ?? '2026-01-01';
    const end = c.req.query('end') ?? '2026-12-31';
    const db = createDb(c.env.DB);

    const rows = await db
      .select({
        laptopId: laptops.id,
        name: laptops.name,
        slug: laptops.slug,
        status: laptops.status,
        bookingCount: sql<number>`count(${bookings.id})`,
        totalRevenue: sql<number>`coalesce(sum(${bookings.totalAmount}), 0)`,
      })
      .from(laptops)
      .leftJoin(bookings, and(
        eq(bookings.laptopId, laptops.id),
        gte(bookings.createdAt, start),
        lte(bookings.createdAt, end + 'T23:59:59'),
      ))
      .groupBy(laptops.id, laptops.name, laptops.slug, laptops.status)
      .orderBy(desc(sql`count(${bookings.id})`));

    return c.json({ data: rows });
  });

  // GET /reports/customers?start=YYYY-MM-DD&end=YYYY-MM-DD
  router.get('/customers', async (c) => {
    const start = c.req.query('start') ?? '2026-01-01';
    const end = c.req.query('end') ?? '2026-12-31';
    const db = createDb(c.env.DB);

    const rows = await db
      .select({
        customerId: customers.id,
        name: customers.name,
        phone: customers.phone,
        bookingCount: sql<number>`count(${bookings.id})`,
        totalSpent: sql<number>`coalesce(sum(${bookings.totalAmount}), 0)`,
      })
      .from(customers)
      .leftJoin(bookings, and(
        eq(bookings.customerId, customers.id),
        gte(bookings.createdAt, start),
        lte(bookings.createdAt, end + 'T23:59:59'),
      ))
      .groupBy(customers.id, customers.name, customers.phone)
      .orderBy(desc(sql`coalesce(sum(${bookings.totalAmount}), 0)`));

    return c.json({ data: rows });
  });

  router.get('/referrals', async (c) => {
    const { page, limit, offset } = parsePagination(c);
    const db = createDb(c.env.DB);

    // Use set-based aggregation: for each customer with a referral code, count how
    // many bookings referenced their code + summed total amount of those bookings.
    const referrers = await db
      .select({
        customerId: customers.id,
        name: customers.name,
        phone: customers.phone,
        referralCode: customers.referralCode,
        referralCount: sql<number>`count(${bookings.id})`,
        totalReferredAmount: sql<number>`coalesce(sum(${bookings.totalAmount}), 0)`,
      })
      .from(customers)
      .leftJoin(bookings, eq(bookings.referredBy, customers.referralCode))
      .where(isNotNull(customers.referralCode))
      .groupBy(customers.id, customers.name, customers.phone, customers.referralCode)
      .orderBy(desc(sql`count(${bookings.id})`))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(customers)
      .where(isNotNull(customers.referralCode));

    return c.json(listResponse(referrers, count, page, limit));
  });

  // GET /reports/referrals/:code — detail of a single referral code incl. referred bookings.
  router.get('/referrals/:code', async (c) => {
    const code = c.req.param('code');
    const db = createDb(c.env.DB);

    const referrer = await db
      .select({ id: customers.id, name: customers.name, phone: customers.phone, referralCode: customers.referralCode })
      .from(customers)
      .where(eq(customers.referralCode, code))
      .limit(1);
    if (!referrer[0]) {
      return c.json({ data: null }, 404);
    }

    const referredBookings = await db
      .select({
        bookingNumber: bookings.bookingNumber,
        customerName: customers.name,
        startDate: bookings.startDate,
        endDate: bookings.endDate,
        totalAmount: bookings.totalAmount,
        status: bookings.status,
        createdAt: bookings.createdAt,
      })
      .from(bookings)
      .innerJoin(customers, eq(bookings.customerId, customers.id))
      .where(eq(bookings.referredBy, code))
      .orderBy(desc(bookings.createdAt));

    const totalReferredAmount = referredBookings.reduce((sum, b) => sum + (b.totalAmount ?? 0), 0);

    return c.json({
      data: {
        ...referrer[0],
        referralCount: referredBookings.length,
        totalReferredAmount,
        referredBookings,
      },
    });
  });

  return router;
}
