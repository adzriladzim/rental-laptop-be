import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, sql, desc } from 'drizzle-orm';
import { createDb } from '../../db';
import { payments, bookings } from '../../db/schema';
import { validateBody, getBody } from '../../lib/validate';
import { NotFoundError, ConflictError } from '../../lib/errors';
import { parsePagination, listResponse } from '../../lib/pagination';
import type { AppEnv } from '../../env';

const verifySchema = z.object({ verifiedBy: z.string().optional().nullable() });
const rejectSchema = z.object({ notes: z.string().optional().nullable() });

export function createPaymentsRouter(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/', async (c) => {
    const { page, limit, offset } = parsePagination(c);
    const db = createDb(c.env.DB);
    const conditions = [];
    const status = c.req.query('status');
    const bookingId = c.req.query('bookingId');
    if (status) conditions.push(eq(payments.status, status as never));
    if (bookingId) conditions.push(eq(payments.bookingId, bookingId));
    const where = conditions.length ? and(...conditions) : undefined;
    const [rows, [{ count }]] = await Promise.all([
      db.select().from(payments).where(where).orderBy(desc(payments.createdAt)).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(payments).where(where),
    ]);
    return c.json(listResponse(rows, count, page, limit));
  });

  router.get('/:id', async (c) => {
    const db = createDb(c.env.DB);
    const rows = await db.select().from(payments).where(eq(payments.id, c.req.param('id'))).limit(1);
    if (!rows[0]) throw new NotFoundError('Payment');
    return c.json({ data: rows[0] });
  });

  router.post('/:id/verify', validateBody(verifySchema), async (c) => {
    const { verifiedBy } = getBody<z.infer<typeof verifySchema>>(c);
    const id = c.req.param('id') as string;
    const db = createDb(c.env.DB);
    const rows = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
    if (!rows[0]) throw new NotFoundError('Payment');
    if (rows[0].status === 'verified') throw new ConflictError('Payment already verified');
    const now = new Date().toISOString();
    await db.update(payments).set({ status: 'verified', verifiedBy: verifiedBy ?? null, verifiedAt: now, updatedAt: now }).where(eq(payments.id, id));
    await db.update(bookings).set({ paymentStatus: 'paid', updatedAt: now }).where(eq(bookings.id, rows[0].bookingId));
    const [updated] = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
    return c.json({ data: updated });
  });

  router.post('/:id/reject', validateBody(rejectSchema), async (c) => {
    const { notes } = getBody<z.infer<typeof rejectSchema>>(c);
    const id = c.req.param('id') as string;
    const db = createDb(c.env.DB);
    const rows = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
    if (!rows[0]) throw new NotFoundError('Payment');
    const now = new Date().toISOString();
    await db.update(payments).set({ status: 'rejected', notes: notes ?? null, updatedAt: now }).where(eq(payments.id, id));
    await db.update(bookings).set({ paymentStatus: 'failed', updatedAt: now }).where(eq(bookings.id, rows[0].bookingId));
    const [updated] = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
    return c.json({ data: updated });
  });

  return router;
}
