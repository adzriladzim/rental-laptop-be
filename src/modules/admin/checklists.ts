import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, sql, desc } from 'drizzle-orm';
import { createDb } from '../../db';
import { laptopChecklists, bookings } from '../../db/schema';
import { validateBody, getBody, validateQuery, getQuery } from '../../lib/validate';
import { NotFoundError, ValidationError } from '../../lib/errors';
import type { AppEnv } from '../../env';

const createSchema = z.object({
  bookingId: z.string().min(1),
  type: z.enum(['pickup', 'return']),
  checklistData: z.record(z.unknown()),
  damageFee: z.number().min(0).optional().default(0),
  performedBy: z.string().optional().nullable(),
});

const listQuery = z.object({ bookingId: z.string().min(1) });

function parseRow(row: typeof laptopChecklists.$inferSelect) {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(row.checklistData) as Record<string, unknown>;
  } catch {
    data = {};
  }
  return { ...row, checklistData: data };
}

export function createChecklistsRouter(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  // GET /admin/checklists?bookingId=...
  router.get('/', validateQuery(listQuery), async (c) => {
    const { bookingId } = getQuery<z.infer<typeof listQuery>>(c);
    const db = createDb(c.env.DB);
    const rows = await db
      .select()
      .from(laptopChecklists)
      .where(eq(laptopChecklists.bookingId, bookingId))
      .orderBy(desc(laptopChecklists.createdAt));
    return c.json({ data: rows.map(parseRow) });
  });

  // POST /admin/checklists — one checklist per (bookingId, type); re-submit updates.
  router.post('/', validateBody(createSchema), async (c) => {
    const body = getBody<z.infer<typeof createSchema>>(c);
    const db = createDb(c.env.DB);

    const existing = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(eq(bookings.id, body.bookingId))
      .limit(1);
    if (!existing[0]) throw new NotFoundError('Booking');

    const values = {
      id: crypto.randomUUID(),
      bookingId: body.bookingId,
      type: body.type,
      checklistData: JSON.stringify(body.checklistData),
      damageFee: body.damageFee ?? 0,
      performedBy: body.performedBy ?? null,
    };

    const [row] = await db
      .insert(laptopChecklists)
      .values(values)
      .onConflictDoUpdate({
        target: [laptopChecklists.bookingId, laptopChecklists.type],
        set: {
          checklistData: sql`excluded.checklist_data`,
          damageFee: sql`excluded.damage_fee`,
          performedBy: sql`excluded.performed_by`,
          createdAt: new Date().toISOString(),
        },
      })
      .returning();

    return c.json({ data: parseRow(row) }, 201);
  });

  // DELETE /admin/checklists/:id
  router.delete('/:id', async (c) => {
    const id = c.req.param('id') as string;
    const db = createDb(c.env.DB);
    const existing = await db
      .select({ id: laptopChecklists.id })
      .from(laptopChecklists)
      .where(eq(laptopChecklists.id, id))
      .limit(1);
    if (!existing[0]) throw new NotFoundError('Checklist');
    await db.delete(laptopChecklists).where(eq(laptopChecklists.id, id));
    return c.json({ message: 'Checklist deleted' });
  });

  return router;
}
