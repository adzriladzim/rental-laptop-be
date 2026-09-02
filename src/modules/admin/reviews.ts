import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, sql, desc } from 'drizzle-orm';
import { createDb } from '../../db';
import { reviews, customers, laptops } from '../../db/schema';
import { validateBody, getBody } from '../../lib/validate';
import { NotFoundError } from '../../lib/errors';
import { parsePagination, listResponse } from '../../lib/pagination';
import type { AppEnv } from '../../env';

const createSchema = z.object({
  customerId: z.string().min(1),
  laptopId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  comment: z.string().optional().nullable(),
});

const updateSchema = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  comment: z.string().optional().nullable(),
});

export function createReviewsRouter(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  // GET /admin/reviews?status=...&customerId=...&laptopId=...
  router.get('/', async (c) => {
    const { page, limit, offset } = parsePagination(c);
    const db = createDb(c.env.DB);
    const conditions = [];
    const status = c.req.query('status');
    const customerId = c.req.query('customerId');
    const laptopId = c.req.query('laptopId');
    if (status) conditions.push(eq(reviews.status, status as never));
    if (customerId) conditions.push(eq(reviews.customerId, customerId));
    if (laptopId) conditions.push(eq(reviews.laptopId, laptopId));
    const where = conditions.length ? and(...conditions) : undefined;
    const [rows, [{ count }]] = await Promise.all([
      db
        .select({
          review: reviews,
          customerName: customers.name,
          laptopName: laptops.name,
        })
        .from(reviews)
        .innerJoin(customers, eq(reviews.customerId, customers.id))
        .innerJoin(laptops, eq(reviews.laptopId, laptops.id))
        .where(where)
        .orderBy(desc(reviews.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(reviews).where(where),
    ]);
    const data = rows.map((r) => ({
      ...r.review,
      customerName: r.customerName,
      laptopName: r.laptopName,
    }));
    return c.json(listResponse(data, count, page, limit));
  });

  // POST /admin/reviews
  router.post('/', validateBody(createSchema), async (c) => {
    const body = getBody<z.infer<typeof createSchema>>(c);
    const db = createDb(c.env.DB);
    const [customer, laptop] = await Promise.all([
      db.select({ id: customers.id }).from(customers).where(eq(customers.id, body.customerId)).limit(1),
      db.select({ id: laptops.id }).from(laptops).where(eq(laptops.id, body.laptopId)).limit(1),
    ]);
    if (!customer[0]) throw new NotFoundError('Customer');
    if (!laptop[0]) throw new NotFoundError('Laptop');
    const id = crypto.randomUUID();
    await db.insert(reviews).values({
      id,
      customerId: body.customerId,
      laptopId: body.laptopId,
      rating: body.rating,
      comment: body.comment ?? null,
      status: 'pending',
    });
    const [created] = await db.select().from(reviews).where(eq(reviews.id, id)).limit(1);
    return c.json({ data: created }, 201);
  });

  // PUT /admin/reviews/:id
  router.put('/:id', validateBody(updateSchema), async (c) => {
    const body = getBody<z.infer<typeof updateSchema>>(c);
    const id = c.req.param('id') as string;
    const db = createDb(c.env.DB);
    const existing = await db.select().from(reviews).where(eq(reviews.id, id)).limit(1);
    if (!existing[0]) throw new NotFoundError('Review');
    await db
      .update(reviews)
      .set({ ...body, updatedAt: new Date().toISOString() })
      .where(eq(reviews.id, id));
    const [updated] = await db.select().from(reviews).where(eq(reviews.id, id)).limit(1);
    return c.json({ data: updated });
  });

  // POST /admin/reviews/:id/approve
  router.post('/:id/approve', async (c) => {
    const id = c.req.param('id') as string;
    const db = createDb(c.env.DB);
    const existing = await db.select().from(reviews).where(eq(reviews.id, id)).limit(1);
    if (!existing[0]) throw new NotFoundError('Review');
    const now = new Date().toISOString();
    await db.update(reviews).set({ status: 'approved', updatedAt: now }).where(eq(reviews.id, id));
    const [updated] = await db.select().from(reviews).where(eq(reviews.id, id)).limit(1);
    return c.json({ data: updated });
  });

  // POST /admin/reviews/:id/reject
  router.post('/:id/reject', async (c) => {
    const id = c.req.param('id') as string;
    const db = createDb(c.env.DB);
    const existing = await db.select().from(reviews).where(eq(reviews.id, id)).limit(1);
    if (!existing[0]) throw new NotFoundError('Review');
    const now = new Date().toISOString();
    await db.update(reviews).set({ status: 'rejected', updatedAt: now }).where(eq(reviews.id, id));
    const [updated] = await db.select().from(reviews).where(eq(reviews.id, id)).limit(1);
    return c.json({ data: updated });
  });

  // DELETE /admin/reviews/:id
  router.delete('/:id', async (c) => {
    const id = c.req.param('id') as string;
    const db = createDb(c.env.DB);
    const existing = await db.select({ id: reviews.id }).from(reviews).where(eq(reviews.id, id)).limit(1);
    if (!existing[0]) throw new NotFoundError('Review');
    await db.delete(reviews).where(eq(reviews.id, id));
    return c.json({ message: 'Review deleted' });
  });

  return router;
}
