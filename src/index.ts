import { Hono } from 'hono';
import { cors } from 'hono/cors';
import * as Sentry from '@sentry/cloudflare';
import { createAuthRouter } from './modules/auth';
import { createPublicRouter } from './modules/public';
import { createAdminRouter } from './modules/admin';
import { createWebhookRouter } from './modules/webhooks';
import { buildErrorResponse } from './lib/errors';
import { runCron } from './lib/cron';
import { adminRateLimit } from './lib/rate-limit';
import type { AppEnv, Env } from './env';

const app = new Hono<AppEnv>();

// CORS — restrict to configured origins, allow credentials for cookie auth.
app.use(
  '*',
  cors({
    origin: (origin, c) => {
      const allowed = (c.env.ALLOWED_PUBLIC_API_ORIGINS ?? 'http://localhost:5173')
        .split(',')
        .map((o: string) => o.trim());
      if (origin && allowed.includes(origin)) return origin;
      if (origin && c.env.ENVIRONMENT !== 'production' && origin.includes('localhost')) return origin;
      return null;
    },
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);

// Security headers.
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (c.env.ENVIRONMENT === 'production') {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
});

// Cache-Control per route pattern.
app.use('*', async (c, next) => {
  const path = c.req.path;
  const method = c.req.method.toUpperCase();

  if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
    c.header('Cache-Control', 'no-store');
    await next();
    return;
  }
  if (method === 'GET') {
    if (/^\/public\/laptops(\/.*)?$/.test(path) && !path.includes('/booked-dates')) {
      c.header('Cache-Control', 'public, max-age=300');
    } else if (path === '/public/settings') {
      c.header('Cache-Control', 'public, max-age=3600');
    } else if (path === '/public/availability') {
      c.header('Cache-Control', 'public, max-age=60');
    } else if (/^\/public\/bookings\//.test(path)) {
      c.header('Cache-Control', 'private, no-cache');
    }
  }
  await next();
});

// Admin rate limiting: login 5/min, write operations 30/min (per IP).
app.use('*', adminRateLimit());

// Centralized error handling.
app.onError((err, c) => {
  console.error('Request error:', err);
  const { status, response } = buildErrorResponse(err);
  return c.json(response, status as 400 | 401 | 403 | 404 | 409 | 500);
});

// Health check.
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Route modules.
app.route('/auth', createAuthRouter());
app.route('/public', createPublicRouter());
app.route('/', createAdminRouter());
app.route('/webhooks', createWebhookRouter());

const worker = {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  // Daily cron (01:00 UTC = 08:00 WIB): auto status transitions + late fees.
  scheduled: async (_event: ScheduledController, env: Env, _ctx: ExecutionContext) => {
    try {
      await runCron(env);
    } catch (err) {
      console.error('[cron] scheduled handler failed:', err);
    }
  },
};

export default Sentry.withSentry(
  (env: Env) => ({
    dsn: env.SENTRY_DSN,
    enabled: env.ENVIRONMENT === 'production',
    tracesSampleRate: 1.0,
  }),
  worker,
);
