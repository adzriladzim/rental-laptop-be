// In-memory fixed-window rate limiter (no external deps).
//
// NOTE: state lives in a module-level Map, i.e. per-isolate. On Cloudflare
// Workers multiple isolates may serve requests, so counts are approximate
// across instances and reset on cold starts. For strict global limits, upgrade
// to Durable Objects or Upstash Ratelimit. Sufficient for single-outlet scale.

import { Context, Next } from 'hono';

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

const MINUTE = 60_000;

// Bucket rules keyed by method + exact path.
const RULES: { method: string; path: string; max: number; windowMs: number; prefix: string }[] = [
  { method: 'POST', path: '/bookings', max: 5, windowMs: MINUTE, prefix: 'pb' },
  { method: 'POST', path: '/leads', max: 5, windowMs: MINUTE, prefix: 'pl' },
  { method: 'GET', path: '/public', max: 60, windowMs: MINUTE, prefix: 'pg' }, // catch-all for any GET under /public
];

function clientIp(c: Context): string {
  const cf = c.req.header('CF-Connecting-IP');
  if (cf) return cf;
  const fwd = c.req.header('X-Forwarded-For');
  if (fwd) return fwd.split(',')[0]!.trim();
  return 'unknown';
}

function resolveRule(method: string, path: string) {
  // Normalize to the path relative to the public router: '/public/laptops'
  // and '/laptops' both become '/laptops' (Hono may report either form).
  const p = path.startsWith('/public') ? path.slice(7) : path;
  for (const r of RULES) {
    if (r.method !== method) continue;
    if (r.path === '/public') {
      // GET /public/* catch-all (any GET under the public router)
      return r;
    } else if (r.path === p) {
      return r;
    }
  }
  return null;
}

export function publicRateLimit() {
  return rateLimitBy(resolveRule);
}

type RateRule = { max: number; windowMs: number; prefix: string };

function rateLimitBy(resolve: (method: string, path: string) => RateRule | null) {
  return async (c: Context, next: Next) => {
    const rule = resolve(c.req.method, c.req.path);
    if (!rule) return next();

    const key = `${rule.prefix}:${clientIp(c)}`;
    const now = Date.now();
    const entry = windows.get(key);

    if (!entry || entry.resetAt <= now) {
      windows.set(key, { count: 1, resetAt: now + rule.windowMs });
      return next();
    }

    entry.count += 1;
    if (entry.count > rule.max) {
      return c.json(
        {
          success: false,
          message: 'Terlalu banyak permintaan, coba lagi nanti',
          error: { code: 'RATE_LIMITED' },
        },
        429,
      );
    }
    return next();
  };
}

// Admin endpoints: login 5/min, other write operations 30/min.
// Skips /public (already limited) and /webhooks (Midtrans server-to-server).
const ADMIN_WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function resolveAdminRule(method: string, path: string): RateRule | null {
  if (method === 'POST' && path === '/auth/login') {
    return { max: 5, windowMs: MINUTE, prefix: 'al' };
  }
  if (
    ADMIN_WRITE_METHODS.has(method) &&
    !path.startsWith('/public') &&
    !path.startsWith('/webhooks') &&
    !path.startsWith('/auth')
  ) {
    return { max: 30, windowMs: MINUTE, prefix: 'aw' };
  }
  return null;
}

export function adminRateLimit() {
  return rateLimitBy(resolveAdminRule);
}
