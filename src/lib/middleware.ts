import { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import jwt from '@tsndr/cloudflare-worker-jwt';
import { and, eq, gt } from 'drizzle-orm';
import { UnauthorizedError, ForbiddenError } from './errors';
import { createDb } from '../db';
import { tokenBlacklist, systemConfig } from '../db/schema';
import { timingSafeEqual } from './crypto';
import type { Env, Role } from '../env';

declare module 'hono' {
  interface ContextVariableMap {
    user: { userId: string; role: Role };
    apiKeyValidated: boolean;
    validatedBody: unknown;
    validatedQuery: unknown;
  }
}

export function authMiddleware() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const authHeader = c.req.header('Authorization');
    const token: string | undefined = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : getCookie(c, 'token');

    if (!token) throw new UnauthorizedError('No token provided');

    try {
      if (!(await jwt.verify(token, c.env.JWT_SECRET))) {
        throw new UnauthorizedError('Invalid token');
      }
      const decoded = jwt.decode(token) as { payload: Record<string, unknown> } | null;
      const p = decoded?.payload;
      if (!p?.userId || !p?.jti) throw new UnauthorizedError('Invalid token payload');
      if ((p.type ?? 'admin') !== 'admin' || !p.role) {
        throw new UnauthorizedError('Invalid token type');
      }

      const db = createDb(c.env.DB);
      const blacklisted = await db
        .select({ jti: tokenBlacklist.jti })
        .from(tokenBlacklist)
        .where(and(eq(tokenBlacklist.jti, String(p.jti)), gt(tokenBlacklist.expiresAt, new Date().toISOString())))
        .limit(1);

      if (blacklisted.length > 0) throw new UnauthorizedError('Token has been revoked');

      c.set('user', { userId: String(p.userId), role: p.role as Role });
      await next();
    } catch (error) {
      if (error instanceof UnauthorizedError) throw error;
      throw new UnauthorizedError('Token verification failed');
    }
  };
}

export function requireRole(...roles: Role[]) {
  return async (c: Context, next: Next) => {
    const user = c.get('user');
    if (!user) throw new UnauthorizedError('Not authenticated');
    if (!roles.includes(user.role)) throw new ForbiddenError('Insufficient permissions');
    await next();
  };
}

async function getConfigValue(c: Context<{ Bindings: Env }>, key: string, fallback: string): Promise<string> {
  const db = createDb(c.env.DB);
  const row = await db
    .select({ value: systemConfig.value })
    .from(systemConfig)
    .where(eq(systemConfig.key, key))
    .limit(1);
  return row[0]?.value ?? fallback;
}

export function apiKeyMiddleware() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const apiKey = c.req.header('X-API-Key');
    if (!apiKey) throw new UnauthorizedError('API key is required. Provide X-API-Key header.');

    const enabled = await getConfigValue(c, 'public_api_enabled', c.env.PUBLIC_API_ENABLED);
    if (enabled !== 'true') throw new UnauthorizedError('Public API is currently disabled');

    const validKey = await getConfigValue(c, 'public_api_key', c.env.PUBLIC_API_KEY);
    if (!validKey || !timingSafeEqual(apiKey, validKey)) {
      throw new UnauthorizedError('Invalid API key');
    }

    c.set('apiKeyValidated', true);
    await next();
  };
}
