import { Hono } from 'hono';
import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { createDb } from '../../db';
import { systemConfig } from '../../db/schema';
import { validateBody, getBody } from '../../lib/validate';
import { NotFoundError } from '../../lib/errors';
import type { AppEnv } from '../../env';

const upsertSchema = z.object({
  key: z.string().min(1),
  value: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
});

const putSchema = z.object({
  key: z.string().min(1).optional(),
  value: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
});

export function createSettingsRouter(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/', async (c) => {
    const db = createDb(c.env.DB);
    const rows = await db.select().from(systemConfig).orderBy(desc(systemConfig.key)).all();
    return c.json({ data: rows });
  });

  router.put('/:key', validateBody(putSchema), async (c) => {
    const body = getBody<z.infer<typeof putSchema>>(c);
    const key = c.req.param('key') as string;
    const db = createDb(c.env.DB);
    const existing = await db.select().from(systemConfig).where(eq(systemConfig.key, key)).limit(1);
    if (!existing[0]) throw new NotFoundError('Settings');

    const nextKey: string = body.key ?? key;
    await db.update(systemConfig).set({
      key: nextKey,
      value: body.value ?? null,
      description: body.description ?? null,
      updatedAt: new Date().toISOString(),
    }).where(eq(systemConfig.key, key));
    const [updated] = await db.select().from(systemConfig).where(eq(systemConfig.key, nextKey)).limit(1);
    return c.json({ data: updated });
  });

  router.post('/', validateBody(upsertSchema), async (c) => {
    const body = getBody<z.infer<typeof upsertSchema>>(c);
    const db = createDb(c.env.DB);
    await db.insert(systemConfig).values({
      key: body.key,
      value: body.value ?? null,
      description: body.description ?? null,
    }).onConflictDoUpdate({
      target: systemConfig.key,
      set: {
        value: body.value ?? null,
        description: body.description ?? null,
        updatedAt: new Date().toISOString(),
      },
    });
    const [row] = await db.select().from(systemConfig).where(eq(systemConfig.key, body.key)).limit(1);
    return c.json({ data: row }, 201);
  });

  router.delete('/:key', async (c) => {
    const key = c.req.param('key') as string;
    const db = createDb(c.env.DB);
    const existing = await db.select().from(systemConfig).where(eq(systemConfig.key, key)).limit(1);
    if (!existing[0]) throw new NotFoundError('Settings');
    await db.delete(systemConfig).where(eq(systemConfig.key, key));
    return c.json({ message: 'Settings deleted' });
  });

  return router;
}
