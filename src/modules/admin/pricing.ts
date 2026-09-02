import { Hono } from 'hono';
import { z } from 'zod';
import { eq, sql, asc } from 'drizzle-orm';
import { createDb } from '../../db';
import { pricingTiers } from '../../db/schema';
import { validateBody, getBody } from '../../lib/validate';
import { NotFoundError, ValidationError } from '../../lib/errors';
import { parsePagination, listResponse } from '../../lib/pagination';
import type { AppEnv } from '../../env';

const createSchema = z.object({
  name: z.string().min(1),
  minDays: z.number().int().min(0),
  maxDays: z.number().int().positive().optional().nullable(),
  discountPercent: z.number().min(0).max(100),
});

const updateSchema = createSchema.partial();

function assertNoOverlap(tiers: { name: string; minDays: number; maxDays: number | null }[]) {
  for (let i = 0; i < tiers.length; i++) {
    for (let j = i + 1; j < tiers.length; j++) {
      const a = tiers[i];
      const b = tiers[j];
      const aMax = a.maxDays ?? Infinity;
      const bMax = b.maxDays ?? Infinity;
      if (a.minDays <= bMax && b.minDays <= aMax) {
        throw new ValidationError(`Tier "${a.name}" overlaps tier "${b.name}" on day range`);
      }
    }
  }
}

export function createPricingRouter(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/', async (c) => {
    const { page, limit, offset } = parsePagination(c);
    const db = createDb(c.env.DB);
    const [rows, [{ count }]] = await Promise.all([
      db.select().from(pricingTiers).orderBy(asc(pricingTiers.minDays)).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(pricingTiers),
    ]);
    return c.json(listResponse(rows, count, page, limit));
  });

  router.get('/:id', async (c) => {
    const db = createDb(c.env.DB);
    const rows = await db.select().from(pricingTiers).where(eq(pricingTiers.id, c.req.param('id'))).limit(1);
    if (!rows[0]) throw new NotFoundError('Pricing tier');
    return c.json({ data: rows[0] });
  });

  router.post('/', validateBody(createSchema), async (c) => {
    const body = getBody<z.infer<typeof createSchema>>(c);
    const db = createDb(c.env.DB);
    const existing = await db.select().from(pricingTiers);
    assertNoOverlap([
      ...existing.map((t) => ({ name: t.name, minDays: t.minDays, maxDays: t.maxDays })),
      { name: body.name, minDays: body.minDays, maxDays: body.maxDays ?? null },
    ]);
    const id = crypto.randomUUID();
    await db.insert(pricingTiers).values({
      id,
      name: body.name,
      minDays: body.minDays,
      maxDays: body.maxDays ?? null,
      discountPercent: body.discountPercent,
    });
    const [created] = await db.select().from(pricingTiers).where(eq(pricingTiers.id, id)).limit(1);
    return c.json({ data: created }, 201);
  });

  router.put('/:id', validateBody(updateSchema), async (c) => {
    const body = getBody<z.infer<typeof updateSchema>>(c);
    const id = c.req.param('id') as string;
    const db = createDb(c.env.DB);
    const rows = await db.select().from(pricingTiers);
    const existing = rows.find((t) => t.id === id);
    if (!existing) throw new NotFoundError('Pricing tier');
    const merged = {
      name: body.name ?? existing.name,
      minDays: body.minDays ?? existing.minDays,
      maxDays: body.maxDays !== undefined ? body.maxDays : existing.maxDays,
    };
    assertNoOverlap([
      ...rows.filter((t) => t.id !== id).map((t) => ({ name: t.name, minDays: t.minDays, maxDays: t.maxDays })),
      merged,
    ]);
    await db.update(pricingTiers)
      .set({ ...body, maxDays: body.maxDays !== undefined ? body.maxDays : existing.maxDays, updatedAt: new Date().toISOString() })
      .where(eq(pricingTiers.id, id));
    const [updated] = await db.select().from(pricingTiers).where(eq(pricingTiers.id, id)).limit(1);
    return c.json({ data: updated });
  });

  router.delete('/:id', async (c) => {
    const id = c.req.param('id') as string;
    const db = createDb(c.env.DB);
    const rows = await db.select().from(pricingTiers).where(eq(pricingTiers.id, id)).limit(1);
    if (!rows[0]) throw new NotFoundError('Pricing tier');
    await db.delete(pricingTiers).where(eq(pricingTiers.id, id));
    return c.json({ message: 'Pricing tier deleted' });
  });

  return router;
}
