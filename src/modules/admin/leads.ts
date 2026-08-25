import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, sql, desc } from 'drizzle-orm';
import { createDb } from '../../db';
import { leads } from '../../db/schema';
import { validateBody, getBody } from '../../lib/validate';
import { NotFoundError } from '../../lib/errors';
import { parsePagination, listResponse } from '../../lib/pagination';
import type { AppEnv } from '../../env';

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  message: z.string().optional().nullable(),
  preferredStart: z.string().optional().nullable(),
  preferredEnd: z.string().optional().nullable(),
  laptopInterest: z.string().optional().nullable(),
  budget: z.string().optional().nullable(),
  purpose: z.string().optional().nullable(),
  source: z.string().optional().nullable(),
  status: z.enum(['New', 'Contacted', 'Qualified', 'Converted', 'Lost']).optional(),
  assignedTo: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const statusSchema = z.object({ status: z.enum(['New', 'Contacted', 'Qualified', 'Converted', 'Lost']) });
const assignSchema = z.object({ assignedTo: z.string().nullable() });

export function createLeadsRouter(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/', async (c) => {
    const { page, limit, offset } = parsePagination(c);
    const db = createDb(c.env.DB);
    const conditions = [];
    const status = c.req.query('status');
    const assignedTo = c.req.query('assignedTo');
    if (status) conditions.push(eq(leads.status, status as never));
    if (assignedTo) conditions.push(eq(leads.assignedTo, assignedTo));
    const where = conditions.length ? and(...conditions) : undefined;
    const [rows, [{ count }]] = await Promise.all([
      db.select().from(leads).where(where).orderBy(desc(leads.createdAt)).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(leads).where(where),
    ]);
    return c.json(listResponse(rows, count, page, limit));
  });

  router.get('/:id', async (c) => {
    const db = createDb(c.env.DB);
    const rows = await db.select().from(leads).where(eq(leads.id, c.req.param('id'))).limit(1);
    if (!rows[0]) throw new NotFoundError('Lead');
    return c.json({ data: rows[0] });
  });

  router.put('/:id', validateBody(updateSchema), async (c) => {
    const body = getBody<z.infer<typeof updateSchema>>(c);
    const id = c.req.param('id') as string;
    const db = createDb(c.env.DB);
    const existing = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
    if (!existing[0]) throw new NotFoundError('Lead');
    await db.update(leads).set({ ...body, updatedAt: new Date().toISOString() }).where(eq(leads.id, id));
    const [updated] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
    return c.json({ data: updated });
  });

  router.post('/:id/status', validateBody(statusSchema), async (c) => {
    const { status } = getBody<z.infer<typeof statusSchema>>(c);
    const id = c.req.param('id') as string;
    const db = createDb(c.env.DB);
    const existing = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
    if (!existing[0]) throw new NotFoundError('Lead');
    await db.update(leads).set({ status, updatedAt: new Date().toISOString() }).where(eq(leads.id, id));
    const [updated] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
    return c.json({ data: updated });
  });

  router.post('/:id/assign', validateBody(assignSchema), async (c) => {
    const { assignedTo } = getBody<z.infer<typeof assignSchema>>(c);
    const id = c.req.param('id') as string;
    const db = createDb(c.env.DB);
    const existing = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
    if (!existing[0]) throw new NotFoundError('Lead');
    await db.update(leads).set({ assignedTo, updatedAt: new Date().toISOString() }).where(eq(leads.id, id));
    const [updated] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
    return c.json({ data: updated });
  });

  router.delete('/:id', async (c) => {
    const id = c.req.param('id') as string;
    const db = createDb(c.env.DB);
    const existing = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
    if (!existing[0]) throw new NotFoundError('Lead');
    await db.delete(leads).where(eq(leads.id, id));
    return c.json({ message: 'Lead deleted' });
  });

  return router;
}
