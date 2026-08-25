import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, sql, desc } from 'drizzle-orm';
import { createDb } from '../../db';
import { partners } from '../../db/schema';
import { validateBody, getBody } from '../../lib/validate';
import { NotFoundError } from '../../lib/errors';
import { parsePagination, listResponse } from '../../lib/pagination';
import type { AppEnv } from '../../env';

const createSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  isActive: z.boolean().optional(),
});

const updateSchema = createSchema.partial();

export function createPartnersRouter(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/', async (c) => {
    const { page, limit, offset } = parsePagination(c);
    const db = createDb(c.env.DB);
    const conditions = [];
    const active = c.req.query('active');
    if (active === 'true') conditions.push(eq(partners.isActive, true));
    if (active === 'false') conditions.push(eq(partners.isActive, false));
    const where = conditions.length ? and(...conditions) : undefined;
    const [rows, [{ count }]] = await Promise.all([
      db.select().from(partners).where(where).orderBy(desc(partners.createdAt)).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(partners).where(where),
    ]);
    return c.json(listResponse(rows, count, page, limit));
  });

  router.get('/:id', async (c) => {
    const db = createDb(c.env.DB);
    const rows = await db.select().from(partners).where(eq(partners.id, c.req.param('id'))).limit(1);
    if (!rows[0]) throw new NotFoundError('Partner');
    return c.json({ data: rows[0] });
  });

  router.post('/', validateBody(createSchema), async (c) => {
    const body = getBody<z.infer<typeof createSchema>>(c);
    const db = createDb(c.env.DB);
    const id = crypto.randomUUID();
    await db.insert(partners).values({
      id,
      name: body.name,
      phone: body.phone ?? null,
      email: body.email ?? null,
      isActive: body.isActive ?? true,
    });
    const [created] = await db.select().from(partners).where(eq(partners.id, id)).limit(1);
    return c.json({ data: created }, 201);
  });

  router.put('/:id', validateBody(updateSchema), async (c) => {
    const body = getBody<z.infer<typeof updateSchema>>(c);
    const id = c.req.param('id') as string;
    const db = createDb(c.env.DB);
    const existing = await db.select().from(partners).where(eq(partners.id, id)).limit(1);
    if (!existing[0]) throw new NotFoundError('Partner');
    await db.update(partners).set({ ...body, updatedAt: new Date().toISOString() }).where(eq(partners.id, id));
    const [updated] = await db.select().from(partners).where(eq(partners.id, id)).limit(1);
    return c.json({ data: updated });
  });

  router.post('/:id/toggle-active', async (c) => {
    const id = c.req.param('id') as string;
    const db = createDb(c.env.DB);
    const rows = await db.select().from(partners).where(eq(partners.id, id)).limit(1);
    if (!rows[0]) throw new NotFoundError('Partner');
    const next = !rows[0].isActive;
    await db.update(partners).set({ isActive: next, updatedAt: new Date().toISOString() }).where(eq(partners.id, id));
    const [updated] = await db.select().from(partners).where(eq(partners.id, id)).limit(1);
    return c.json({ data: updated });
  });

  router.delete('/:id', async (c) => {
    const id = c.req.param('id') as string;
    const db = createDb(c.env.DB);
    const existing = await db.select().from(partners).where(eq(partners.id, id)).limit(1);
    if (!existing[0]) throw new NotFoundError('Partner');
    await db.delete(partners).where(eq(partners.id, id));
    return c.json({ message: 'Partner deleted' });
  });

  return router;
}
