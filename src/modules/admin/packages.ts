import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, sql, desc } from 'drizzle-orm';
import { createDb } from '../../db';
import { packages } from '../../db/schema';
import { validateBody, getBody, validateQuery, getQuery } from '../../lib/validate';
import { NotFoundError } from '../../lib/errors';
import { parsePagination, listResponse } from '../../lib/pagination';
import type { AppEnv } from '../../env';

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  laptopIds: z.array(z.string()).min(1),
  price: z.number().positive(),
  durationDays: z.number().int().positive(),
  isActive: z.boolean().optional(),
});

const updateSchema = createSchema.partial();

const listQuery = z.object({
  search: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
});

export function createPackagesRouter(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/', validateQuery(listQuery), async (c) => {
    const q = getQuery<z.infer<typeof listQuery>>(c);
    const { page, limit, offset } = parsePagination(c);
    const db = createDb(c.env.DB);
    const conditions = [];
    if (q.isActive != null) conditions.push(eq(packages.isActive, q.isActive));
    if (q.search) conditions.push(sql`${packages.name} LIKE ${`%${q.search}%`}`);
    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, [{ count }]] = await Promise.all([
      db.select().from(packages).where(where).orderBy(desc(packages.createdAt)).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(packages).where(where),
    ]);
    return c.json(listResponse(rows, count, page, limit));
  });

  router.get('/:id', async (c) => {
    const db = createDb(c.env.DB);
    const rows = await db.select().from(packages).where(eq(packages.id, c.req.param('id'))).limit(1);
    if (!rows[0]) throw new NotFoundError('Package');
    return c.json({ data: rows[0] });
  });

  router.post('/', validateBody(createSchema), async (c) => {
    const body = getBody<z.infer<typeof createSchema>>(c);
    const db = createDb(c.env.DB);
    const id = crypto.randomUUID();
    await db.insert(packages).values({
      id,
      name: body.name,
      description: body.description ?? null,
      laptopIds: body.laptopIds,
      price: body.price,
      durationDays: body.durationDays,
      isActive: body.isActive ?? true,
    });
    const [created] = await db.select().from(packages).where(eq(packages.id, id)).limit(1);
    return c.json({ data: created }, 201);
  });

  router.put('/:id', validateBody(updateSchema), async (c) => {
    const body = getBody<z.infer<typeof updateSchema>>(c);
    const id = c.req.param('id') as string;
    const db = createDb(c.env.DB);
    const existing = await db.select().from(packages).where(eq(packages.id, id)).limit(1);
    if (!existing[0]) throw new NotFoundError('Package');
    await db.update(packages)
      .set({ ...body, updatedAt: new Date().toISOString() })
      .where(eq(packages.id, id));
    const [updated] = await db.select().from(packages).where(eq(packages.id, id)).limit(1);
    return c.json({ data: updated });
  });

  router.post('/:id/toggle-status', async (c) => {
    const id = c.req.param('id') as string;
    const db = createDb(c.env.DB);
    const rows = await db.select().from(packages).where(eq(packages.id, id)).limit(1);
    if (!rows[0]) throw new NotFoundError('Package');
    const next = rows[0].isActive ? false : true;
    await db.update(packages).set({ isActive: next, updatedAt: new Date().toISOString() }).where(eq(packages.id, id));
    const [updated] = await db.select().from(packages).where(eq(packages.id, id)).limit(1);
    return c.json({ data: updated });
  });

  router.delete('/:id', async (c) => {
    const id = c.req.param('id') as string;
    const db = createDb(c.env.DB);
    const rows = await db.select().from(packages).where(eq(packages.id, id)).limit(1);
    if (!rows[0]) throw new NotFoundError('Package');
    await db.delete(packages).where(eq(packages.id, id));
    return c.json({ message: 'Package deleted' });
  });

  return router;
}
