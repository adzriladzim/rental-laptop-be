import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, sql, desc } from 'drizzle-orm';
import { createDb } from '../../db';
import { laptops, partners } from '../../db/schema';
import { validateBody, getBody, validateQuery, getQuery } from '../../lib/validate';
import { NotFoundError, ConflictError, ValidationError } from '../../lib/errors';
import { parsePagination, listResponse } from '../../lib/pagination';
import type { AppEnv } from '../../env';

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
}

const createSchema = z.object({
  name: z.string().min(1),
  brand: z.string().min(1),
  model: z.string().min(1),
  category: z.string().min(1),
  specs: z.record(z.unknown()).optional().nullable(),
  dailyRate: z.number().positive(),
  weeklyRate: z.number().positive().optional().nullable(),
  monthlyRate: z.number().positive().optional().nullable(),
  status: z.enum(['Available', 'Rented', 'Maintenance', 'Inactive']).optional(),
  slug: z.string().optional(),
  photoUrl: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  partnerId: z.string().optional().nullable(),
});

const updateSchema = createSchema.partial();

const listQuery = z.object({
  status: z.string().optional(),
  category: z.string().optional(),
  brand: z.string().optional(),
  search: z.string().optional(),
});

export function createLaptopsRouter(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/', validateQuery(listQuery), async (c) => {
    const q = getQuery<z.infer<typeof listQuery>>(c);
    const { page, limit, offset } = parsePagination(c);
    const db = createDb(c.env.DB);
    const conditions = [];
    if (q.status) conditions.push(eq(laptops.status, q.status as never));
    if (q.category) conditions.push(eq(laptops.category, q.category));
    if (q.brand) conditions.push(eq(laptops.brand, q.brand));
    if (q.search) conditions.push(sql`(${laptops.name} LIKE ${`%${q.search}%`} OR ${laptops.model} LIKE ${`%${q.search}%`})`);
    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, [{ count }]] = await Promise.all([
      db.select().from(laptops).where(where).orderBy(desc(laptops.createdAt)).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(laptops).where(where),
    ]);
    return c.json(listResponse(rows, count, page, limit));
  });

  router.get('/:id', async (c) => {
    const db = createDb(c.env.DB);
    const rows = await db.select().from(laptops).where(eq(laptops.id, c.req.param('id'))).limit(1);
    if (!rows[0]) throw new NotFoundError('Laptop');
    return c.json({ data: rows[0] });
  });

  router.post('/', validateBody(createSchema), async (c) => {
    const body = getBody<z.infer<typeof createSchema>>(c);
    const db = createDb(c.env.DB);
    let slug = body.slug ?? slugify(`${body.brand}-${body.model}-${body.name}`);
    const existing = await db.select({ id: laptops.id }).from(laptops).where(eq(laptops.slug, slug)).limit(1);
    if (existing[0]) slug = `${slug}-${crypto.randomUUID().slice(0, 6)}`;
    if (body.partnerId) {
      const partner = await db.select({ id: partners.id }).from(partners).where(eq(partners.id, body.partnerId)).limit(1);
      if (!partner[0]) throw new NotFoundError('Partner');
    }
    const id = crypto.randomUUID();
    await db.insert(laptops).values({
      id,
      name: body.name,
      brand: body.brand,
      model: body.model,
      category: body.category,
      specs: body.specs as never,
      dailyRate: body.dailyRate,
      weeklyRate: body.weeklyRate ?? null,
      monthlyRate: body.monthlyRate ?? null,
      status: body.status ?? 'Available',
      slug,
      photoUrl: body.photoUrl ?? null,
      description: body.description ?? null,
      partnerId: body.partnerId ?? null,
    });
    const [created] = await db.select().from(laptops).where(eq(laptops.id, id)).limit(1);
    return c.json({ data: created }, 201);
  });

  router.put('/:id', validateBody(updateSchema), async (c) => {
    const body = getBody<z.infer<typeof updateSchema>>(c);
    const id = c.req.param('id') as string;
    const db = createDb(c.env.DB);
    const existing = await db.select().from(laptops).where(eq(laptops.id, id)).limit(1);
    if (!existing[0]) throw new NotFoundError('Laptop');
    if (body.partnerId) {
      const partner = await db.select({ id: partners.id }).from(partners).where(eq(partners.id, body.partnerId)).limit(1);
      if (!partner[0]) throw new NotFoundError('Partner');
    }
    await db.update(laptops).set({ ...body, specs: body.specs as never, updatedAt: new Date().toISOString() }).where(eq(laptops.id, id));
    const [updated] = await db.select().from(laptops).where(eq(laptops.id, id)).limit(1);
    return c.json({ data: updated });
  });

  router.post('/:id/toggle-status', async (c) => {
    const id = c.req.param('id') as string;
    const db = createDb(c.env.DB);
    const rows = await db.select().from(laptops).where(eq(laptops.id, id)).limit(1);
    if (!rows[0]) throw new NotFoundError('Laptop');
    const next = rows[0].status === 'Available' ? 'Inactive' : 'Available';
    await db.update(laptops).set({ status: next, updatedAt: new Date().toISOString() }).where(eq(laptops.id, id));
    const [updated] = await db.select().from(laptops).where(eq(laptops.id, id)).limit(1);
    return c.json({ data: updated });
  });

  router.delete('/:id', async (c) => {
    const id = c.req.param('id') as string;
    const db = createDb(c.env.DB);
    const rows = await db.select().from(laptops).where(eq(laptops.id, id)).limit(1);
    if (!rows[0]) throw new NotFoundError('Laptop');
    await db.delete(laptops).where(eq(laptops.id, id));
    return c.json({ message: 'Laptop deleted' });
  });

  return router;
}
