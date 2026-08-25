import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, sql, desc } from 'drizzle-orm';
import { createDb } from '../../db';
import { maintenanceRecords, laptops } from '../../db/schema';
import { validateBody, getBody } from '../../lib/validate';
import { NotFoundError, ConflictError } from '../../lib/errors';
import { parsePagination, listResponse } from '../../lib/pagination';
import type { AppEnv } from '../../env';

const createSchema = z.object({
  laptopId: z.string().min(1),
  type: z.enum(['Scheduled', 'Repair', 'Upgrade', 'Cleaning', 'Inspection']),
  description: z.string().optional().nullable(),
  cost: z.number().optional().nullable(),
  status: z.enum(['Pending', 'InProgress', 'Completed', 'Cancelled']).optional(),
  scheduledDate: z.string().optional().nullable(),
  performedBy: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  createdBy: z.string().optional().nullable(),
});

const updateSchema = createSchema.partial();

async function setLaptopStatus(db: ReturnType<typeof createDb>, laptopId: string, status: string) {
  await db.update(laptops).set({ status: status as never, updatedAt: new Date().toISOString() }).where(eq(laptops.id, laptopId));
}

export function createMaintenanceRouter(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/', async (c) => {
    const { page, limit, offset } = parsePagination(c);
    const db = createDb(c.env.DB);
    const conditions = [];
    const laptopId = c.req.query('laptopId');
    const status = c.req.query('status');
    if (laptopId) conditions.push(eq(maintenanceRecords.laptopId, laptopId));
    if (status) conditions.push(eq(maintenanceRecords.status, status as never));
    const where = conditions.length ? and(...conditions) : undefined;
    const [rows, [{ count }]] = await Promise.all([
      db.select().from(maintenanceRecords).where(where).orderBy(desc(maintenanceRecords.createdAt)).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(maintenanceRecords).where(where),
    ]);
    return c.json(listResponse(rows, count, page, limit));
  });

  router.get('/:id', async (c) => {
    const db = createDb(c.env.DB);
    const rows = await db.select().from(maintenanceRecords).where(eq(maintenanceRecords.id, c.req.param('id'))).limit(1);
    if (!rows[0]) throw new NotFoundError('Maintenance record');
    return c.json({ data: rows[0] });
  });

  router.post('/', validateBody(createSchema), async (c) => {
    const body = getBody<z.infer<typeof createSchema>>(c);
    const db = createDb(c.env.DB);
    const laptop = await db.select().from(laptops).where(eq(laptops.id, body.laptopId)).limit(1);
    if (!laptop[0]) throw new NotFoundError('Laptop');
    const id = crypto.randomUUID();
    await db.insert(maintenanceRecords).values({
      id,
      laptopId: body.laptopId,
      type: body.type,
      description: body.description ?? null,
      cost: body.cost ?? null,
      status: body.status ?? 'Pending',
      scheduledDate: body.scheduledDate ?? null,
      performedBy: body.performedBy ?? null,
      notes: body.notes ?? null,
      createdBy: body.createdBy ?? null,
    });
    const [created] = await db.select().from(maintenanceRecords).where(eq(maintenanceRecords.id, id)).limit(1);
    return c.json({ data: created }, 201);
  });

  router.put('/:id', validateBody(updateSchema), async (c) => {
    const body = getBody<z.infer<typeof updateSchema>>(c);
    const id = c.req.param('id') as string;
    const db = createDb(c.env.DB);
    const existing = await db.select().from(maintenanceRecords).where(eq(maintenanceRecords.id, id)).limit(1);
    if (!existing[0]) throw new NotFoundError('Maintenance record');
    await db.update(maintenanceRecords).set({ ...body, updatedAt: new Date().toISOString() }).where(eq(maintenanceRecords.id, id));
    const [updated] = await db.select().from(maintenanceRecords).where(eq(maintenanceRecords.id, id)).limit(1);
    return c.json({ data: updated });
  });

  router.post('/:id/start', async (c) => {
    const id = c.req.param('id') as string;
    const db = createDb(c.env.DB);
    const rows = await db.select().from(maintenanceRecords).where(eq(maintenanceRecords.id, id)).limit(1);
    if (!rows[0]) throw new NotFoundError('Maintenance record');
    if (rows[0].status === 'Completed' || rows[0].status === 'Cancelled') {
      throw new ConflictError(`Cannot start maintenance in status '${rows[0].status}'`);
    }
    const now = new Date().toISOString();
    await db.update(maintenanceRecords).set({ status: 'InProgress', startedAt: now, updatedAt: now }).where(eq(maintenanceRecords.id, id));
    await setLaptopStatus(db, rows[0].laptopId, 'Maintenance');
    const [updated] = await db.select().from(maintenanceRecords).where(eq(maintenanceRecords.id, id)).limit(1);
    return c.json({ data: updated });
  });

  router.post('/:id/complete', async (c) => {
    const id = c.req.param('id') as string;
    const db = createDb(c.env.DB);
    const rows = await db.select().from(maintenanceRecords).where(eq(maintenanceRecords.id, id)).limit(1);
    if (!rows[0]) throw new NotFoundError('Maintenance record');
    if (rows[0].status === 'Completed' || rows[0].status === 'Cancelled') {
      throw new ConflictError(`Cannot complete maintenance in status '${rows[0].status}'`);
    }
    const now = new Date().toISOString();
    await db.update(maintenanceRecords).set({ status: 'Completed', completedAt: now, updatedAt: now }).where(eq(maintenanceRecords.id, id));
    // Release laptop only if no other open maintenance exists
    const open = await db
      .select({ id: maintenanceRecords.id })
      .from(maintenanceRecords)
      .where(and(eq(maintenanceRecords.laptopId, rows[0].laptopId), sql`${maintenanceRecords.status} IN ('Pending','InProgress')`))
      .limit(1);
    if (open.length === 0) await setLaptopStatus(db, rows[0].laptopId, 'Available');
    const [updated] = await db.select().from(maintenanceRecords).where(eq(maintenanceRecords.id, id)).limit(1);
    return c.json({ data: updated });
  });

  router.delete('/:id', async (c) => {
    const id = c.req.param('id') as string;
    const db = createDb(c.env.DB);
    const existing = await db.select().from(maintenanceRecords).where(eq(maintenanceRecords.id, id)).limit(1);
    if (!existing[0]) throw new NotFoundError('Maintenance record');
    await db.delete(maintenanceRecords).where(eq(maintenanceRecords.id, id));
    return c.json({ message: 'Maintenance record deleted' });
  });

  return router;
}
