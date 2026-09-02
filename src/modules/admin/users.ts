import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, sql, desc } from 'drizzle-orm';
import { createDb } from '../../db';
import { users } from '../../db/schema';
import { hashPassword } from '../../lib/crypto';
import { validateBody, getBody } from '../../lib/validate';
import { NotFoundError, ConflictError } from '../../lib/errors';
import { parsePagination, listResponse } from '../../lib/pagination';
import { requireRole } from '../../lib/middleware';
import type { AppEnv, Role } from '../../env';

const ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'STAFF'];

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().min(3),
  password: z.string().min(6),
  role: z.enum(['SUPER_ADMIN', 'ADMIN', 'STAFF']).default('STAFF'),
  isActive: z.boolean().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().min(3).optional(),
  password: z.string().min(6).optional(),
  role: z.enum(['SUPER_ADMIN', 'ADMIN', 'STAFF']).optional(),
  isActive: z.boolean().optional(),
});

export function createUsersRouter(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/', async (c) => {
    const { page, limit, offset } = parsePagination(c);
    const db = createDb(c.env.DB);
    const search = c.req.query('search');
    const conditions = [];
    if (search) conditions.push(sql`(${users.name} LIKE ${`%${search}%`} OR ${users.email} LIKE ${`%${search}%`})`);
    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, [{ count }]] = await Promise.all([
      db.select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        isActive: users.isActive,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      }).from(users).where(where).orderBy(desc(users.createdAt)).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(users).where(where),
    ]);
    return c.json(listResponse(rows, count, page, limit));
  });

  router.post('/', requireRole('SUPER_ADMIN'), validateBody(createSchema), async (c) => {
    const body = getBody<z.infer<typeof createSchema>>(c);
    const db = createDb(c.env.DB);
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
    if (existing[0]) throw new ConflictError('User with this email already exists');
    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(body.password);
    await db.insert(users).values({
      id,
      name: body.name,
      email: body.email,
      passwordHash,
      role: body.role,
      isActive: body.isActive ?? true,
    });
    const [created] = await db.select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    }).from(users).where(eq(users.id, id)).limit(1);
    return c.json({ data: created }, 201);
  });

  router.put('/:id', requireRole('SUPER_ADMIN'), validateBody(updateSchema), async (c) => {
    const body = getBody<z.infer<typeof updateSchema>>(c);
    const id = c.req.param('id') as string;
    const db = createDb(c.env.DB);
    const existing = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!existing[0]) throw new NotFoundError('User');
    if (body.email && body.email !== existing[0].email) {
      const dup = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
      if (dup[0]) throw new ConflictError('Another user with this email already exists');
    }
    const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (body.name !== undefined) patch.name = body.name;
    if (body.email !== undefined) patch.email = body.email;
    if (body.role !== undefined) patch.role = body.role;
    if (body.isActive !== undefined) patch.isActive = body.isActive;
    if (body.password) patch.passwordHash = await hashPassword(body.password);
    await db.update(users).set(patch).where(eq(users.id, id));
    const [updated] = await db.select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    }).from(users).where(eq(users.id, id)).limit(1);
    return c.json({ data: updated });
  });

  router.delete('/:id', requireRole('SUPER_ADMIN'), async (c) => {
    const id = c.req.param('id') as string;
    const db = createDb(c.env.DB);
    const authUser = c.get('user');
    if (authUser && authUser.userId === id) {
      throw new ConflictError('Cannot delete your own account');
    }
    const existing = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!existing[0]) throw new NotFoundError('User');
    await db.delete(users).where(eq(users.id, id));
    return c.json({ message: 'User deleted' });
  });

  return router;
}
