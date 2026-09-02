import { Hono, Context } from 'hono';
import { z } from 'zod';
import { eq, and, sql, desc } from 'drizzle-orm';
import { createDb } from '../../db';
import { bookings, laptops, customers } from '../../db/schema';
import { validateBody, getBody } from '../../lib/validate';
import { NotFoundError, ConflictError, ValidationError, BlacklistedError } from '../../lib/errors';
import { parsePagination, listResponse } from '../../lib/pagination';
import { daysBetween, calcTotal, unavailableLaptopIds, overlapCounts, ACTIVE_BOOKING_STATUSES, generateBookingNumber } from '../../lib/booking';
import type { AppEnv } from '../../env';

const VALID_TRANSITIONS: Record<string, string[]> = {
  Pending: ['Confirmed', 'Cancelled'],
  pending_payment: ['Confirmed', 'Cancelled', 'expired'],
  Confirmed: ['Active', 'Cancelled'],
  Active: ['Completed', 'Cancelled'],
  Completed: ['refunded'],
  Cancelled: [],
  expired: [],
  refunded: [],
};

const updateSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  actualReturnDate: z.string().optional().nullable(),
  status: z.enum(['Pending', 'pending_payment', 'Confirmed', 'Active', 'Completed', 'Cancelled', 'expired', 'refunded']).optional(),
  paymentStatus: z.string().optional().nullable(),
  totalAmount: z.number().optional(),
  lateFee: z.number().optional().nullable(),
  damageFee: z.number().optional().nullable(),
  totalPenalty: z.number().optional().nullable(),
  depositAmount: z.number().optional().nullable(),
  depositStatus: z.enum(['none', 'held', 'refunded', 'forfeited']).optional(),
  notes: z.string().optional().nullable(),
});

// Recompute a laptop's availability status from its active-booking count vs quantity.
// Only overrides 'Available'/'Rented'; leaves manual 'Maintenance'/'Inactive' untouched.
async function recomputeLaptopStatus(db: ReturnType<typeof createDb>, laptopId: string) {
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
  await db.update(laptops).set({ status: next as never, updatedAt: new Date().toISOString() }).where(eq(laptops.id, laptopId));
}

function bookingsListWhere(c: Context<AppEnv>) {
  const conditions = [];
  const status = c.req.query('status');
  const customerId = c.req.query('customerId');
  const laptopId = c.req.query('laptopId');
  if (status) conditions.push(eq(bookings.status, status as never));
  if (customerId) conditions.push(eq(bookings.customerId, customerId));
  if (laptopId) conditions.push(eq(bookings.laptopId, laptopId));
  return conditions.length ? and(...conditions) : undefined;
}

export function createBookingsRouter(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/', async (c) => {
    const { page, limit, offset } = parsePagination(c);
    const db = createDb(c.env.DB);
    const where = bookingsListWhere(c);
    const [rows, [{ count }]] = await Promise.all([
      db.select().from(bookings).where(where).orderBy(desc(bookings.createdAt)).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(bookings).where(where),
    ]);
    return c.json(listResponse(rows, count, page, limit));
  });

  router.get('/:id', async (c) => {
    const db = createDb(c.env.DB);
    const rows = await db.select().from(bookings).where(eq(bookings.id, c.req.param('id'))).limit(1);
    if (!rows[0]) throw new NotFoundError('Booking');
    return c.json({ data: rows[0] });
  });

  // POST / — admin manual booking creation.
  const createSchema = z.object({
    customerId: z.string().optional(),
    customerName: z.string().optional(),
    customerPhone: z.string().optional(),
    laptopId: z.string().min(1),
    startDate: z.string().min(1),
    endDate: z.string().min(1),
    notes: z.string().optional().nullable(),
    rentalReason: z.string().optional().nullable(),
    paymentStatus: z.string().optional(),
    depositAmount: z.number().optional().nullable(),
  });

  router.post('/', validateBody(createSchema), async (c) => {
    const body = getBody<z.infer<typeof createSchema>>(c);
    const db = createDb(c.env.DB);

    // Laptop must exist and not be Maintenance/Inactive.
    const laptopRows = await db.select().from(laptops).where(eq(laptops.id, body.laptopId)).limit(1);
    const laptop = laptopRows[0];
    if (!laptop) throw new NotFoundError('Laptop');
    if (laptop.status === 'Maintenance' || laptop.status === 'Inactive') {
      throw new ConflictError(`Laptop is ${laptop.status.toLowerCase()} and cannot be booked`);
    }

    if (new Date(body.endDate) < new Date(body.startDate)) {
      throw new ValidationError('endDate must be after startDate');
    }

    // Resolve customer: by id (existing) or find-or-create by phone (new).
    let customerId: string;
    if (body.customerId) {
      const crows = await db.select().from(customers).where(eq(customers.id, body.customerId)).limit(1);
      const cust = crows[0];
      if (!cust) throw new NotFoundError('Customer');
      if (cust.isBlacklisted) throw new BlacklistedError('Customer is blacklisted');
      customerId = cust.id;
    } else {
      if (!body.customerPhone || !body.customerName) {
        throw new ValidationError('customerName and customerPhone are required when customerId is not provided');
      }
      const existing = await db.select().from(customers).where(eq(customers.phone, body.customerPhone)).limit(1);
      const found = existing[0];
      if (found) {
        if (found.isBlacklisted) throw new BlacklistedError('Customer is blacklisted');
        customerId = found.id;
      } else {
        const cid = crypto.randomUUID();
        await db.insert(customers).values({ id: cid, name: body.customerName, phone: body.customerPhone });
        customerId = cid;
      }
    }

    // Conflict check (booking + maintenance auto-block).
    const conflicts = await unavailableLaptopIds(db, body.startDate, body.endDate);
    if (conflicts.includes(laptop.id)) {
      throw new ConflictError('Laptop is unavailable for the selected dates (booking or maintenance conflict)');
    }

    const days = daysBetween(body.startDate, body.endDate);
    const total = calcTotal(days, laptop.dailyRate, laptop.weeklyRate, laptop.monthlyRate);
    const bookingNumber = await generateBookingNumber(db);

    const bid = crypto.randomUUID();
    const depositAmount = body.depositAmount ?? 0;
    await db.insert(bookings).values({
      id: bid,
      bookingNumber,
      customerId,
      laptopId: laptop.id,
      startDate: body.startDate,
      endDate: body.endDate,
      status: 'Confirmed',
      paymentStatus: body.paymentStatus || 'unpaid',
      totalAmount: total,
      depositAmount,
      depositStatus: depositAmount > 0 ? 'none' : 'none',
      notes: body.notes ?? null,
      rentalReason: body.rentalReason ?? null,
    });
    const booking = (await db.select().from(bookings).where(eq(bookings.id, bid)).limit(1))[0];
    const counts = await overlapCounts(db, body.startDate, body.endDate);
    const remainingUnits = (laptop.quantity ?? 1) - (counts.get(laptop.id) ?? 0);
    return c.json({ data: { ...booking, remainingUnits } }, 201);
  });

  router.put('/:id', validateBody(updateSchema), async (c) => {
    const body = getBody<z.infer<typeof updateSchema>>(c);
    const id = c.req.param('id') as string;
    const db = createDb(c.env.DB);
    const existing = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
    if (!existing[0]) throw new NotFoundError('Booking');
    await db.update(bookings).set({ ...body, updatedAt: new Date().toISOString() }).where(eq(bookings.id, id));
    const [updated] = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
    return c.json({ data: updated });
  });

  const advance = (action: 'confirm' | 'start' | 'complete' | 'cancel') =>
    async (c: Context<AppEnv>) => {
      const id = c.req.param('id') as string;
      const db = createDb(c.env.DB);
      const rows = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
      const booking = rows[0];
      if (!booking) throw new NotFoundError('Booking');

      const target =
        action === 'confirm' ? 'Confirmed' :
        action === 'start' ? 'Active' :
        action === 'complete' ? 'Completed' : 'Cancelled';

      const allowed = VALID_TRANSITIONS[booking.status] ?? [];
      if (!allowed.includes(target)) {
        throw new ConflictError(`Cannot ${action} booking in status '${booking.status}'`);
      }

      const patch: Record<string, unknown> = { status: target, updatedAt: new Date().toISOString() };
      if (action === 'complete') {
        patch.actualReturnDate = new Date().toISOString();
        // Auto-refund deposit on completion if still held.
        if (booking.depositStatus === 'held') {
          patch.depositStatus = 'refunded';
        }
        if (booking.laptopId) await recomputeLaptopStatus(db, booking.laptopId);
      }
      if (action === 'cancel') {
        // Auto-refund deposit on cancellation if still held.
        if (booking.depositStatus === 'held') {
          patch.depositStatus = 'refunded';
        }
        if (booking.laptopId) await recomputeLaptopStatus(db, booking.laptopId);
      }
      if (action === 'start') {
        if (booking.laptopId) await recomputeLaptopStatus(db, booking.laptopId);
      }

      await db.update(bookings).set(patch).where(eq(bookings.id, id));
      const [updated] = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
      return c.json({ data: updated });
    };

  router.post('/:id/confirm', advance('confirm'));
  router.post('/:id/start', advance('start'));
  router.post('/:id/complete', advance('complete'));
  router.post('/:id/cancel', advance('cancel'));

  // POST /bookings/:id/deposit — convenience endpoint to set deposit status.
  const depositSchema = z.object({
    status: z.enum(['held', 'refunded', 'forfeited']),
  });

  router.post('/:id/deposit', validateBody(depositSchema), async (c) => {
    const { status } = getBody<z.infer<typeof depositSchema>>(c);
    const id = c.req.param('id') as string;
    const db = createDb(c.env.DB);
    const existing = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
    if (!existing[0]) throw new NotFoundError('Booking');
    await db
      .update(bookings)
      .set({ depositStatus: status, updatedAt: new Date().toISOString() })
      .where(eq(bookings.id, id));
    const [updated] = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
    return c.json({ data: updated });
  });

  router.delete('/:id', async (c) => {
    const id = c.req.param('id') as string;
    const db = createDb(c.env.DB);
    const existing = await db.select({ id: bookings.id }).from(bookings).where(eq(bookings.id, id)).limit(1);
    if (!existing[0]) throw new NotFoundError('Booking');
    await db.delete(bookings).where(eq(bookings.id, id));
    return c.json({ message: 'Booking deleted' });
  });

  return router;
}
