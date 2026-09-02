import { Hono, Context } from 'hono';
import { z } from 'zod';
import { eq, and, sql, desc, asc, or, inArray, lt, gt } from 'drizzle-orm';
import { createDb } from '../db';
import { laptops, customers, bookings, leads, systemConfig, reviews, packages, pricingTiers } from '../db/schema';
import { apiKeyMiddleware } from '../lib/middleware';
import { publicRateLimit } from '../lib/rate-limit';
import { validateBody, getBody, validateQuery, getQuery } from '../lib/validate';
import { NotFoundError, ConflictError, ValidationError, BlacklistedError } from '../lib/errors';
import { daysBetween, calcTotal, unavailableLaptopIds, overlapCounts, generateBookingNumber, generateReferralCode, ACTIVE_BOOKING_STATUSES } from '../lib/booking';
import { createSnapToken } from '../lib/payment';
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
  laptopSlug: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  notes: z.string().optional(),
  guaranteeDoc1: z.string().optional().nullable(),
  guaranteeDoc2: z.string().optional().nullable(),
  homeAddress: z.string().optional().nullable(),
  deliveryAddress: z.string().optional().nullable(),
  officeAddress: z.string().optional().nullable(),
  familyContactRelation: z.string().optional().nullable(),
  familyContactPhone: z.string().optional().nullable(),
  instagram: z.string().optional().nullable(),
  linkedin: z.string().optional().nullable(),
  isDomisiliMatch: z.coerce.boolean().optional().default(false),
  hasOwnLaptop: z.coerce.boolean().optional().default(false),
  rentalReason: z.string().optional().nullable(),
  referredBy: z.string().optional().nullable(),
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

const bookedDatesQuery = z.object({
  start: z.string().min(1),
  end: z.string().min(1),
});

export function createPublicRouter(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.use('*', apiKeyMiddleware());
  // In-memory fixed-window rate limiting on public routes (per IP).
  router.use('*', publicRateLimit());

  // GET /public/settings
  router.get('/settings', async (c) => {
    const db = createDb(c.env.DB);
    const [name, phone, email, address, bankName, bankAccountNumber, bankAccountHolder, depositAmountStr] =
      await Promise.all([
        getConfigValue(db, 'business_name', c.env.BUSINESS_NAME),
        getConfigValue(db, 'business_phone', c.env.BUSINESS_PHONE),
        getConfigValue(db, 'business_email', c.env.BUSINESS_EMAIL),
        getConfigValue(db, 'business_address', c.env.BUSINESS_ADDRESS),
        getConfigValue(db, 'bank_name', ''),
        getConfigValue(db, 'bank_account_number', ''),
        getConfigValue(db, 'bank_account_holder', ''),
        getConfigValue(db, 'deposit_amount', '0'),
      ]);
    return c.json({
      data: {
        name,
        phone,
        email,
        address,
        currency: 'IDR',
        timezone: 'Asia/Jakarta',
        depositAmount: Number(depositAmountStr) || 0,
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

  // GET /public/laptops/:slug/booked-dates?start=YYYY-MM-DD&end=YYYY-MM-DD
  // Returns every date (ISO YYYY-MM-DD) in [start, end) covered by an active
  // booking of this laptop, so the booking calendar can grey them out up front.
  router.get('/laptops/:slug/booked-dates', validateQuery(bookedDatesQuery), async (c) => {
    const slug = c.req.param('slug')!;
    const { start, end } = getQuery<z.infer<typeof bookedDatesQuery>>(c);
    if (new Date(end) < new Date(start)) {
      throw new ValidationError('end must be after start');
    }
    const db = createDb(c.env.DB);
    const laptopRows = await db
      .select({ id: laptops.id })
      .from(laptops)
      .where(eq(laptops.slug, slug))
      .limit(1);
    const laptop = laptopRows[0];
    if (!laptop) throw new NotFoundError('Laptop');

    const rows = await db
      .select({ startDate: bookings.startDate, endDate: bookings.endDate })
      .from(bookings)
      .where(
        and(
          eq(bookings.laptopId, laptop.id),
          sql`${bookings.status} IN ${sql.raw(`('${ACTIVE_BOOKING_STATUSES.join("', '")}')`)}`,
          lt(bookings.startDate, end),
          gt(bookings.endDate, start),
        ),
      );

    const dates = new Set<string>();
    for (const r of rows) {
      const from = r.startDate > start ? r.startDate : start;
      const to = r.endDate < end ? r.endDate : end;
      const cur = new Date(`${from}T00:00:00Z`);
      const stop = new Date(`${to}T00:00:00Z`);
      while (cur < stop) {
        dates.add(cur.toISOString().slice(0, 10));
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
    }
    return c.json({ data: { dates: [...dates].sort() } });
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

    // Read deposit amount from system_config (set via admin panel).
    const depositAmountStr = await getConfigValue(db, 'deposit_amount', '0');
    const depositAmount = Number(depositAmountStr) || 0;

    // NOTE: D1 does not support db.transaction() (BEGIN TRANSACTION rejected).
    // Sequential operations instead — acceptable for single-outlet rental scale.
    let customer = foundCustomer;
    if (customer) {
      // Update existing customer's new fields if provided
      const patch: Record<string, unknown> = {};
      if (body.guaranteeDoc1 != null) patch.guaranteeDoc1 = body.guaranteeDoc1;
      if (body.guaranteeDoc2 != null) patch.guaranteeDoc2 = body.guaranteeDoc2;
      if (body.homeAddress != null) patch.homeAddress = body.homeAddress;
      if (body.deliveryAddress != null) patch.deliveryAddress = body.deliveryAddress;
      if (body.officeAddress != null) patch.officeAddress = body.officeAddress;
      if (body.familyContactRelation != null) patch.familyContactRelation = body.familyContactRelation;
      if (body.familyContactPhone != null) patch.familyContactPhone = body.familyContactPhone;
      if (body.instagram != null) patch.instagram = body.instagram;
      if (body.linkedin != null) patch.linkedin = body.linkedin;
      if (body.isDomisiliMatch != null) patch.isDomisiliMatch = body.isDomisiliMatch;
      if (body.hasOwnLaptop != null) patch.hasOwnLaptop = body.hasOwnLaptop;
      if (Object.keys(patch).length) {
        await db.update(customers).set({ ...patch, updatedAt: new Date().toISOString() }).where(eq(customers.id, customer.id));
        customer = (await db.select().from(customers).where(eq(customers.id, customer.id)).limit(1))[0];
      }
    } else {
      const cid = crypto.randomUUID();
      const referralCode = await generateReferralCode(db);
      await db.insert(customers).values({
        id: cid,
        name: body.customerName,
        phone: body.customerPhone,
        email: null,
        guaranteeDoc1: body.guaranteeDoc1 ?? null,
        guaranteeDoc2: body.guaranteeDoc2 ?? null,
        homeAddress: body.homeAddress ?? null,
        deliveryAddress: body.deliveryAddress ?? null,
        officeAddress: body.officeAddress ?? null,
        familyContactRelation: body.familyContactRelation ?? null,
        familyContactPhone: body.familyContactPhone ?? null,
        instagram: body.instagram ?? null,
        linkedin: body.linkedin ?? null,
        isDomisiliMatch: body.isDomisiliMatch ?? false,
        hasOwnLaptop: body.hasOwnLaptop ?? false,
        referralCode,
      });
      customer = (await db.select().from(customers).where(eq(customers.id, cid)).limit(1))[0];
    }

    // Create snap token — real Midtrans if server key set, mock otherwise.
    const { token: snapToken } = await createSnapToken({
      orderId: bookingNumber,
      amount: total + depositAmount,
      customerName: body.customerName,
      customerPhone: body.customerPhone,
      env: c.env.ENVIRONMENT,
      midtransServerKey: c.env.MIDTRANS_SERVER_KEY,
    });

    const bid = crypto.randomUUID();
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
      depositAmount,
      depositStatus: depositAmount > 0 ? 'none' : 'none',
      snapToken,
      notes: body.notes || null,
      rentalReason: body.rentalReason ?? null,
      referredBy: body.referredBy ?? null,
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
          depositAmount: result.booking.depositAmount ?? 0,
          depositStatus: result.booking.depositStatus,
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
        depositAmount: bookings.depositAmount,
        depositStatus: bookings.depositStatus,
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
        depositAmount: r.depositAmount ?? 0,
        depositStatus: r.depositStatus,
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
      .select({ b: bookings, laptopName: laptops.name, laptopSlug: laptops.slug, customerName: customers.name, customerPhone: customers.phone })
      .from(bookings)
      .leftJoin(laptops, eq(bookings.laptopId, laptops.id))
      .leftJoin(customers, eq(bookings.customerId, customers.id))
      .where(eq(bookings.bookingNumber, bookingNumber))
      .limit(1);
    if (!rows[0]) throw new NotFoundError('Booking');
    const { b, laptopName, laptopSlug, customerName, customerPhone } = rows[0];
    return c.json({
      data: {
        bookingNumber: b.bookingNumber,
        status: b.status,
        paymentStatus: b.paymentStatus,
        totalAmount: b.totalAmount,
        depositAmount: b.depositAmount ?? 0,
        depositStatus: b.depositStatus,
        startDate: b.startDate,
        endDate: b.endDate,
        actualReturnDate: b.actualReturnDate,
        lateFee: b.lateFee ?? 0,
        totalPenalty: b.totalPenalty ?? 0,
        customerName: customerName ?? null,
        customerPhone: customerPhone ?? null,
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

  // GET /public/referral/:code
  // Validate a referral code and return the referrer's public info.
  router.get('/referral/:code', async (c) => {
    const code = c.req.param('code');
    const db = createDb(c.env.DB);
    const rows = await db
      .select({ id: customers.id, name: customers.name, referralCode: customers.referralCode })
      .from(customers)
      .where(eq(customers.referralCode, code))
      .limit(1);
    if (!rows[0]) throw new NotFoundError('Referral code');
    return c.json({
      data: {
        valid: true,
        code: rows[0].referralCode,
        referrerName: rows[0].name,
      },
    });
  });

  // GET /public/packages — active packages only, for the landing page.
  router.get('/packages', async (c) => {
    const db = createDb(c.env.DB);
    const rows = await db
      .select()
      .from(packages)
      .where(eq(packages.isActive, true))
      .orderBy(desc(packages.createdAt));
    return c.json({ data: rows });
  });

  // GET /public/pricing-tiers — all tiers ordered by min_days.
  router.get('/pricing-tiers', async (c) => {
    const db = createDb(c.env.DB);
    const rows = await db
      .select()
      .from(pricingTiers)
      .orderBy(asc(pricingTiers.minDays));
    return c.json({ data: rows });
  });

  // GET /public/reviews — approved reviews only, for the landing page testimoni.
  router.get('/reviews', async (c) => {
    const db = createDb(c.env.DB);
    const rows = await db
      .select({
        id: reviews.id,
        rating: reviews.rating,
        comment: reviews.comment,
        createdAt: reviews.createdAt,
        customerName: customers.name,
        laptopName: laptops.name,
      })
      .from(reviews)
      .innerJoin(customers, eq(reviews.customerId, customers.id))
      .innerJoin(laptops, eq(reviews.laptopId, laptops.id))
      .where(eq(reviews.status, 'approved'))
      .orderBy(desc(reviews.createdAt))
      .limit(100);
    return c.json({
      data: rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment ?? '',
        createdAt: r.createdAt,
        customerName: r.customerName,
        laptopName: r.laptopName,
      })),
    });
  });

  return router;
}
