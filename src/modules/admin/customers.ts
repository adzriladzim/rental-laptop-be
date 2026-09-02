import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, sql, desc } from 'drizzle-orm';
import { createDb } from '../../db';
import { customers } from '../../db/schema';
import { validateBody, getBody } from '../../lib/validate';
import { NotFoundError, ConflictError } from '../../lib/errors';
import { parsePagination, listResponse } from '../../lib/pagination';
import type { AppEnv } from '../../env';

const createSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(5),
  email: z.string().email().optional().nullable(),
  idNumber: z.string().optional().nullable(),
  idType: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  company: z.string().optional().nullable(),
  guaranteeDoc1: z.string().optional().nullable(),
  guaranteeDoc2: z.string().optional().nullable(),
  homeAddress: z.string().optional().nullable(),
  deliveryAddress: z.string().optional().nullable(),
  officeAddress: z.string().optional().nullable(),
  familyContact: z.string().optional().nullable(),
  familyContactRelation: z.string().optional().nullable(),
  familyContactPhone: z.string().optional().nullable(),
  instagram: z.string().optional().nullable(),
  linkedin: z.string().optional().nullable(),
  isDomisiliMatch: z.boolean().optional().default(false),
  hasOwnLaptop: z.boolean().optional().default(false),
});

const updateSchema = createSchema.partial();
const blacklistSchema = z.object({ isBlacklisted: z.boolean(), blacklistReason: z.string().optional().nullable() });

export function createCustomersRouter(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/', async (c) => {
    const { page, limit, offset } = parsePagination(c);
    const db = createDb(c.env.DB);
    const conditions = [];
    const search = c.req.query('search');
    const blacklisted = c.req.query('blacklisted');
    if (search) conditions.push(sql`(${customers.name} LIKE ${`%${search}%`} OR ${customers.phone} LIKE ${`%${search}%`} OR ${customers.email} LIKE ${`%${search}%`})`);
    if (blacklisted === 'true') conditions.push(eq(customers.isBlacklisted, true));
    if (blacklisted === 'false') conditions.push(eq(customers.isBlacklisted, false));
    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, [{ count }]] = await Promise.all([
      db.select().from(customers).where(where).orderBy(desc(customers.createdAt)).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(customers).where(where),
    ]);
    return c.json(listResponse(rows, count, page, limit));
  });

  router.get('/:id', async (c) => {
    const db = createDb(c.env.DB);
    const rows = await db.select().from(customers).where(eq(customers.id, c.req.param('id'))).limit(1);
    if (!rows[0]) throw new NotFoundError('Customer');
    return c.json({ data: rows[0] });
  });

  router.post('/', validateBody(createSchema), async (c) => {
    const body = getBody<z.infer<typeof createSchema>>(c);
    const db = createDb(c.env.DB);
    const existing = await db.select({ id: customers.id }).from(customers).where(eq(customers.phone, body.phone)).limit(1);
    if (existing[0]) throw new ConflictError('Customer with this phone already exists');
    const id = crypto.randomUUID();
    await db.insert(customers).values({
      id,
      name: body.name,
      phone: body.phone,
      email: body.email ?? null,
      idNumber: body.idNumber ?? null,
      idType: body.idType ?? null,
      address: body.address ?? null,
      company: body.company ?? null,
      guaranteeDoc1: body.guaranteeDoc1 ?? null,
      guaranteeDoc2: body.guaranteeDoc2 ?? null,
      homeAddress: body.homeAddress ?? null,
      deliveryAddress: body.deliveryAddress ?? null,
      officeAddress: body.officeAddress ?? null,
      familyContact: body.familyContact ?? null,
      familyContactRelation: body.familyContactRelation ?? null,
      familyContactPhone: body.familyContactPhone ?? null,
      instagram: body.instagram ?? null,
      linkedin: body.linkedin ?? null,
      isDomisiliMatch: body.isDomisiliMatch ?? false,
      hasOwnLaptop: body.hasOwnLaptop ?? false,
    });
    const [created] = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
    return c.json({ data: created }, 201);
  });

  router.put('/:id', validateBody(updateSchema), async (c) => {
    const body = getBody<z.infer<typeof updateSchema>>(c);
    const id = c.req.param('id') as string;
    const db = createDb(c.env.DB);
    const existing = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
    if (!existing[0]) throw new NotFoundError('Customer');
    if (body.phone && body.phone !== existing[0].phone) {
      const dup = await db.select({ id: customers.id }).from(customers).where(eq(customers.phone, body.phone)).limit(1);
      if (dup[0]) throw new ConflictError('Another customer with this phone already exists');
    }
    await db.update(customers).set({ ...body, updatedAt: new Date().toISOString() }).where(eq(customers.id, id));
    const [updated] = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
    return c.json({ data: updated });
  });

  router.post('/:id/blacklist', validateBody(blacklistSchema), async (c) => {
    const body = getBody<z.infer<typeof blacklistSchema>>(c);
    const id = c.req.param('id') as string;
    const db = createDb(c.env.DB);
    const existing = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
    if (!existing[0]) throw new NotFoundError('Customer');
    if (body.isBlacklisted && !body.blacklistReason) {
      throw new ConflictError('blacklistReason is required when blacklisting');
    }
    await db.update(customers).set({
      isBlacklisted: body.isBlacklisted,
      blacklistReason: body.isBlacklisted ? (body.blacklistReason ?? null) : null,
      updatedAt: new Date().toISOString(),
    }).where(eq(customers.id, id));
    const [updated] = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
    return c.json({ data: updated });
  });

  router.delete('/:id', async (c) => {
    const id = c.req.param('id') as string;
    const db = createDb(c.env.DB);
    const existing = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
    if (!existing[0]) throw new NotFoundError('Customer');
    await db.delete(customers).where(eq(customers.id, id));
    return c.json({ message: 'Customer deleted' });
  });

  return router;
}
