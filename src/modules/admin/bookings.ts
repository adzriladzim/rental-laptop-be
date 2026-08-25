import { Hono, Context } from 'hono';
import { z } from 'zod';
import { eq, and, sql, desc } from 'drizzle-orm';
import { createDb } from '../../db';
import { bookings, laptops, customers } from '../../db/schema';
import { validateBody, getBody } from '../../lib/validate';
import { NotFoundError, ConflictError, ValidationError } from '../../lib/errors';
import { parsePagination, listResponse } from '../../lib/pagination';
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
  notes: z.string().optional().nullable(),
});

async function setLaptopStatus(db: ReturnType<typeof createDb>, laptopId: string, status: string) {
  await db.update(laptops).set({ status: status as never, updatedAt: new Date().toISOString() }).where(eq(laptops.id, laptopId));
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
        if (booking.laptopId) await setLaptopStatus(db, booking.laptopId, 'Available');
      }
      if (action === 'cancel') {
        if (booking.laptopId) await setLaptopStatus(db, booking.laptopId, 'Available');
      }
      if (action === 'start') {
        if (booking.laptopId) await setLaptopStatus(db, booking.laptopId, 'Rented');
      }

      await db.update(bookings).set(patch).where(eq(bookings.id, id));
      const [updated] = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
      return c.json({ data: updated });
    };

  router.post('/:id/confirm', advance('confirm'));
  router.post('/:id/start', advance('start'));
  router.post('/:id/complete', advance('complete'));
  router.post('/:id/cancel', advance('cancel'));

  return router;
}
