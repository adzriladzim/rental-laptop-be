import { Hono, Context } from 'hono';
import { z } from 'zod';
import { eq, and, sql, desc } from 'drizzle-orm';
import { createDb } from '../db';
import { laptops, customers, bookings, leads, systemConfig } from '../db/schema';
import { apiKeyMiddleware } from '../lib/middleware';
import { validateBody, getBody, validateQuery, getQuery } from '../lib/validate';
import { NotFoundError, ConflictError, ValidationError } from '../lib/errors';
import type { AppEnv } from '../env';

const ACTIVE_BOOKING_STATUSES = ['Pending', 'pending_payment', 'Confirmed', 'Active'];

function daysBetween(start: string, end: string): number {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return 0;
  return Math.max(1, Math.ceil((e - s) / 86_400_000));
}

// Real pricelist (uniform all units, from @sewaintop):
// 175k/day (1-2d) · 160k/day (3-6d) · weekly 875k => 125k/day (7-29d) · monthly 2400k => 80k/day (30d+)
const THREE_PLUS_DAY_RATE = 160_000;

function calcTotal(
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

async function conflictingLaptopIds(
  db: ReturnType<typeof createDb>,
  start: string,
  end: string,
): Promise<string[]> {
  const statusIn = `('${ACTIVE_BOOKING_STATUSES.join("', '")}')`;
  const rows = await db
    .select({ laptopId: bookings.laptopId })
    .from(bookings)
    .where(
      and(
        sql`${bookings.status} IN ${sql.raw(statusIn)}`,
        sql`${bookings.startDate} < ${end} AND ${bookings.endDate} > ${start}`,
      ),
    );
  return rows.map((r) => r.laptopId);
}

async function generateBookingNumber(db: ReturnType<typeof createDb>): Promise<string> {
  const year = new Date().getFullYear();
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(bookings)
    .where(sql`${bookings.bookingNumber} LIKE ${`LPR-${year}-%`}`);
  return `LPR-${year}-${String((count ?? 0) + 1).padStart(4, '0')}`;
}

async function getConfigValue(db: ReturnType<typeof createDb>, key: string, fallback: string) {
  const row = await db.select({ value: systemConfig.value }).from(systemConfig).where(eq(systemConfig.key, key)).limit(1);
  return row[0]?.value ?? fallback;
}

// --- Schemas ---
const availabilityQuery = z.object({
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  category: z.string().optional(),
});

const bookingBody = z.object({
  customerName: z.string().min(1),
  customerPhone: z.string().min(5),
  customerEmail: z.string().email().optional().or(z.literal('')),
  laptopSlug: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  notes: z.string().optional(),
});

const leadBody = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  message: z.string().optional(),
  preferredStart: z.string().optional(),
  preferredEnd: z.string().optional(),
  laptopInterest: z.string().optional(),
  budget: z.string().optional(),
  purpose: z.string().optional(),
  source: z.string().optional(),
});

const laptopQuery = z.object({
  category: z.string().optional(),
  brand: z.string().optional(),
  minDailyRate: z.coerce.number().optional(),
  maxDailyRate: z.coerce.number().optional(),
  search: z.string().optional(),
});

export function createPublicRouter(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.use('*', apiKeyMiddleware());

  // GET /public/settings
  router.get('/settings', async (c) => {
    const db = createDb(c.env.DB);
    const [name, phone, email, address] = await Promise.all([
      getConfigValue(db, 'business_name', c.env.BUSINESS_NAME),
      getConfigValue(db, 'business_phone', c.env.BUSINESS_PHONE),
      getConfigValue(db, 'business_email', c.env.BUSINESS_EMAIL),
      getConfigValue(db, 'business_address', c.env.BUSINESS_ADDRESS),
    ]);
    return c.json({
      data: { name, phone, email, address, currency: 'IDR', timezone: 'Asia/Jakarta' },
    });
  });

  // GET /public/availability
  router.get('/availability', validateQuery(availabilityQuery), async (c) => {
    const { startDate, endDate, category } = getQuery<z.infer<typeof availabilityQuery>>(c);
    if (new Date(endDate) < new Date(startDate)) {
      throw new ValidationError('endDate must be after startDate');
    }
    const db = createDb(c.env.DB);
    const conflicts = await conflictingLaptopIds(db, startDate, endDate);
    const conditions = [eq(laptops.status, 'Available')];
    if (category) conditions.push(eq(laptops.category, category));
    if (conflicts.length) conditions.push(sql`${laptops.id} NOT IN ${conflicts}`);
    const rows = await db.select().from(laptops).where(and(...conditions));
    return c.json({ data: rows });
  });

  // GET /public/laptops
  router.get('/laptops', validateQuery(laptopQuery), async (c) => {
    const q = getQuery<z.infer<typeof laptopQuery>>(c);
    const db = createDb(c.env.DB);
    const conditions = [sql`${laptops.status} != 'Inactive'`];
    if (q.category) conditions.push(eq(laptops.category, q.category));
    if (q.brand) conditions.push(eq(laptops.brand, q.brand));
    if (q.minDailyRate != null) conditions.push(sql`${laptops.dailyRate} >= ${q.minDailyRate}`);
    if (q.maxDailyRate != null) conditions.push(sql`${laptops.dailyRate} <= ${q.maxDailyRate}`);
    if (q.search) conditions.push(sql`(${laptops.name} LIKE ${`%${q.search}%`} OR ${laptops.brand} LIKE ${`%${q.search}%`} OR ${laptops.model} LIKE ${`%${q.search}%`})`);
    const rows = await db.select().from(laptops).where(and(...conditions)).orderBy(desc(laptops.createdAt));
    return c.json({ data: rows });
  });

  // GET /public/laptops/:slug
  router.get('/laptops/:slug', async (c) => {
    const slug = c.req.param('slug');
    const db = createDb(c.env.DB);
    const rows = await db.select().from(laptops).where(eq(laptops.slug, slug)).limit(1);
    if (!rows[0]) throw new NotFoundError('Laptop');
    return c.json({ data: rows[0] });
  });

  // POST /public/bookings
  router.post('/bookings', validateBody(bookingBody), async (c) => {
    const body = getBody<z.infer<typeof bookingBody>>(c);
    const db = createDb(c.env.DB);

    const laptopRows = await db.select().from(laptops).where(eq(laptops.slug, body.laptopSlug)).limit(1);
    const laptop = laptopRows[0];
    if (!laptop) throw new NotFoundError('Laptop');
    if (laptop.status !== 'Available') throw new ConflictError('Laptop is not available for booking');

    if (new Date(body.endDate) < new Date(body.startDate)) {
      throw new ValidationError('endDate must be after startDate');
    }
    const conflicts = await conflictingLaptopIds(db, body.startDate, body.endDate);
    if (conflicts.includes(laptop.id)) throw new ConflictError('Laptop already booked for the selected dates');

    const days = daysBetween(body.startDate, body.endDate);
    const total = calcTotal(days, laptop.dailyRate, laptop.weeklyRate, laptop.monthlyRate);
    const bookingNumber = await generateBookingNumber(db);

    // NOTE: D1 does not support db.transaction() (BEGIN TRANSACTION rejected).
    // Sequential operations instead — acceptable for single-outlet rental scale.
    let customer = (await db.select().from(customers).where(eq(customers.phone, body.customerPhone)).limit(1))[0];
    if (!customer) {
      const cid = crypto.randomUUID();
      await db.insert(customers).values({
        id: cid,
        name: body.customerName,
        phone: body.customerPhone,
        email: body.customerEmail || null,
      });
      customer = (await db.select().from(customers).where(eq(customers.id, cid)).limit(1))[0];
    }
    const bid = crypto.randomUUID();
    const snapToken = `mock-snap-${bookingNumber}`;
    await db.insert(bookings).values({
      id: bid,
      bookingNumber,
      customerId: customer.id,
      laptopId: laptop.id,
      startDate: body.startDate,
      endDate: body.endDate,
      status: 'Pending',
      paymentStatus: 'unpaid',
      totalAmount: total,
      snapToken,
      notes: body.notes || null,
    });
    const booking = (await db.select().from(bookings).where(eq(bookings.id, bid)).limit(1))[0];
    const result = { booking, customer };

    return c.json(
      {
        data: {
          bookingNumber: result.booking.bookingNumber,
          status: result.booking.status,
          paymentStatus: result.booking.paymentStatus,
          totalAmount: result.booking.totalAmount,
          snapToken: result.booking.snapToken,
          startDate: result.booking.startDate,
          endDate: result.booking.endDate,
          laptop: { id: laptop.id, name: laptop.name, slug: laptop.slug },
        },
      },
      201,
    );
  });

  // GET /public/bookings/:bookingNumber/status
  router.get('/bookings/:bookingNumber/status', async (c) => {
    const bookingNumber = c.req.param('bookingNumber');
    const db = createDb(c.env.DB);
    const rows = await db.select().from(bookings).where(eq(bookings.bookingNumber, bookingNumber)).limit(1);
    if (!rows[0]) throw new NotFoundError('Booking');
    const b = rows[0];
    return c.json({
      data: {
        bookingNumber: b.bookingNumber,
        status: b.status,
        paymentStatus: b.paymentStatus,
        totalAmount: b.totalAmount,
        startDate: b.startDate,
        endDate: b.endDate,
        actualReturnDate: b.actualReturnDate,
      },
    });
  });

  // POST /public/leads
  router.post('/leads', validateBody(leadBody), async (c) => {
    const body = getBody<z.infer<typeof leadBody>>(c);
    const db = createDb(c.env.DB);
    const [lead] = await db
      .insert(leads)
      .values({
        id: crypto.randomUUID(),
        name: body.name,
        phone: body.phone ?? null,
        email: body.email || null,
        message: body.message ?? null,
        preferredStart: body.preferredStart ?? null,
        preferredEnd: body.preferredEnd ?? null,
        laptopInterest: body.laptopInterest ?? null,
        budget: body.budget ?? null,
        purpose: body.purpose ?? null,
        source: body.source ?? 'public_api',
        status: 'New',
      })
      .returning();
    return c.json({ data: lead }, 201);
  });

  return router;
}
