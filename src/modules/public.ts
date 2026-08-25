import { Hono, Context } from 'hono';
import { z } from 'zod';
import { eq, and, sql, desc, or, inArray } from 'drizzle-orm';
import { createDb } from '../db';
import { laptops, customers, bookings, leads, systemConfig } from '../db/schema';
import { apiKeyMiddleware } from '../lib/middleware';
import { validateBody, getBody, validateQuery, getQuery } from '../lib/validate';
import { NotFoundError, ConflictError, ValidationError, BlacklistedError } from '../lib/errors';
import { daysBetween, calcTotal, unavailableLaptopIds, overlapCounts, generateBookingNumber } from '../lib/booking';
import type { AppEnv } from '../env';

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

// Normalize a phone number into comparable digit variants.
// Accepts 08..., 628..., +628... and matches any stored variant.
function phoneCandidates(raw: string): string[] {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return [];
  const set = new Set<string>([digits]);
  if (digits.startsWith('0')) set.add(`62${digits.slice(1)}`);
  else if (digits.startsWith('62')) set.add(`0${digits.slice(2)}`);
  return [...set];
}

const lookupQuery = z.object({ phone: z.string().min(5) });

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
    const [name, phone, email, address, bankName, bankAccountNumber, bankAccountHolder] =
      await Promise.all([
        getConfigValue(db, 'business_name', c.env.BUSINESS_NAME),
        getConfigValue(db, 'business_phone', c.env.BUSINESS_PHONE),
        getConfigValue(db, 'business_email', c.env.BUSINESS_EMAIL),
        getConfigValue(db, 'business_address', c.env.BUSINESS_ADDRESS),
        getConfigValue(db, 'bank_name', ''),
        getConfigValue(db, 'bank_account_number', ''),
        getConfigValue(db, 'bank_account_holder', ''),
      ]);
    return c.json({
      data: {
        name,
        phone,
        email,
        address,
        currency: 'IDR',
        timezone: 'Asia/Jakarta',
        bank: {
          name: bankName,
          accountNumber: bankAccountNumber,
          accountHolder: bankAccountHolder,
        },
      },
    });
  });

  // GET /public/availability
  router.get('/availability', validateQuery(availabilityQuery), async (c) => {
    const { startDate, endDate, category } = getQuery<z.infer<typeof availabilityQuery>>(c);
    if (new Date(endDate) < new Date(startDate)) {
      throw new ValidationError('endDate must be after startDate');
    }
    const db = createDb(c.env.DB);
    const unavailable = await unavailableLaptopIds(db, startDate, endDate);
    const counts = await overlapCounts(db, startDate, endDate);
    const conditions = [eq(laptops.status, 'Available')];
    if (category) conditions.push(eq(laptops.category, category));
    if (unavailable.length) conditions.push(sql`${laptops.id} NOT IN ${unavailable}`);
    const rows = await db.select().from(laptops).where(and(...conditions));
    const data = rows.map((l) => ({
      ...l,
      remainingUnits: (l.quantity ?? 1) - (counts.get(l.id) ?? 0),
    }));
    return c.json({ data });
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

    // B5: resolve customer by phone FIRST — blacklisted existing customers are rejected
    // before any booking/conflict work. New (not-found) customers proceed normally.
    const customerRows = await db.select().from(customers).where(eq(customers.phone, body.customerPhone)).limit(1);
    const foundCustomer = customerRows[0];
    if (foundCustomer?.isBlacklisted) {
      throw new BlacklistedError('Maaf, Anda tidak dapat melakukan booking. Hubungi kami untuk informasi.');
    }

    const conflicts = await unavailableLaptopIds(db, body.startDate, body.endDate);
    if (conflicts.includes(laptop.id)) throw new ConflictError('Laptop already booked for the selected dates');

    const days = daysBetween(body.startDate, body.endDate);
    const total = calcTotal(days, laptop.dailyRate, laptop.weeklyRate, laptop.monthlyRate);
    const bookingNumber = await generateBookingNumber(db);

    // NOTE: D1 does not support db.transaction() (BEGIN TRANSACTION rejected).
    // Sequential operations instead — acceptable for single-outlet rental scale.
    let customer = foundCustomer;
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
    const counts = await overlapCounts(db, body.startDate, body.endDate);
    const remainingUnits = (laptop.quantity ?? 1) - (counts.get(laptop.id) ?? 0);

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
          remainingUnits,
          laptop: { id: laptop.id, name: laptop.name, slug: laptop.slug },
        },
      },
      201,
    );
  });

  // GET /public/bookings/lookup?phone=...
  // Normalize phone variants (08/628/+628) and return the customer's bookings.
  router.get('/bookings/lookup', validateQuery(lookupQuery), async (c) => {
    const { phone } = getQuery<z.infer<typeof lookupQuery>>(c);
    const db = createDb(c.env.DB);
    const candidates = phoneCandidates(phone);
    if (!candidates.length) return c.json({ data: [] });

    const ors = candidates.map((cand) => sql`${customers.phone} LIKE ${`%${cand}%`}`);
    const matched = await db
      .select({ id: customers.id })
      .from(customers)
      .where(or(...ors));
    if (!matched.length) return c.json({ data: [] });

    const customerIds = matched.map((m) => m.id);
    const rows = await db
      .select({
        bookingNumber: bookings.bookingNumber,
        status: bookings.status,
        paymentStatus: bookings.paymentStatus,
        startDate: bookings.startDate,
        endDate: bookings.endDate,
        totalAmount: bookings.totalAmount,
        createdAt: bookings.createdAt,
        laptopName: laptops.name,
        laptopSlug: laptops.slug,
      })
      .from(bookings)
      .innerJoin(laptops, eq(bookings.laptopId, laptops.id))
      .where(inArray(bookings.customerId, customerIds))
      .orderBy(desc(bookings.createdAt));

    return c.json({
      data: rows.map((r) => ({
        bookingNumber: r.bookingNumber,
        status: r.status,
        paymentStatus: r.paymentStatus,
        startDate: r.startDate,
        endDate: r.endDate,
        totalAmount: r.totalAmount,
        laptop: { name: r.laptopName, slug: r.laptopSlug },
        createdAt: r.createdAt,
      })),
    });
  });

  // GET /public/bookings/:bookingNumber/status
  router.get('/bookings/:bookingNumber/status', async (c) => {
    const bookingNumber = c.req.param('bookingNumber');
    const db = createDb(c.env.DB);
    const rows = await db
      .select({ b: bookings, laptopName: laptops.name, laptopSlug: laptops.slug })
      .from(bookings)
      .leftJoin(laptops, eq(bookings.laptopId, laptops.id))
      .where(eq(bookings.bookingNumber, bookingNumber))
      .limit(1);
    if (!rows[0]) throw new NotFoundError('Booking');
    const { b, laptopName, laptopSlug } = rows[0];
    return c.json({
      data: {
        bookingNumber: b.bookingNumber,
        status: b.status,
        paymentStatus: b.paymentStatus,
        totalAmount: b.totalAmount,
        startDate: b.startDate,
        endDate: b.endDate,
        actualReturnDate: b.actualReturnDate,
        laptop: laptopName ? { name: laptopName, slug: laptopSlug } : null,
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
