import { app } from '../../src/index'
import { FakeD1 } from './fake-d1'
import { SCHEMA_DDL } from './schema-ddl'
import { hashPassword } from '../../src/lib/crypto'
import type { Env } from '../../src/env'

export const SEED_USER = { email: 'sewaintop', password: 'admin123' }

const DEV_JWT = 'dev-only-change-me-in-production'

export function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: undefined as unknown as D1Database,
    ENVIRONMENT: 'development',
    SENTRY_DSN: '',
    JWT_SECRET: DEV_JWT,
    PUBLIC_API_KEY: 'lpr_public_dev_key',
    PUBLIC_API_ENABLED: 'true',
    BUSINESS_NAME: 'SewaTop',
    BUSINESS_PHONE: '+6281234567890',
    BUSINESS_EMAIL: 'halo@sewalaptop.id',
    BUSINESS_ADDRESS: 'Jakarta',
    PAYMENT_WEBHOOK_SECRET: 'dev-webhook-secret',
    ALLOWED_PUBLIC_API_ORIGINS: 'http://localhost:3000,http://localhost:5173',
    MIDTRANS_SERVER_KEY: '',
    MIDTRANS_CLIENT_KEY: '',
    ...overrides,
  }
}

export interface TestContext {
  d1: FakeD1
  env: Env
}

/** Create an in-memory DB + env, apply schema. */
export function newContext(overrides: Partial<Env> = {}): TestContext {
  const d1 = new FakeD1()
  for (const stmt of SCHEMA_DDL.split(';')) {
    const s = stmt.trim()
    if (s) d1.exec(s)
  }
  const env = makeEnv(overrides)
  env.DB = d1 as unknown as D1Database
  return { d1, env }
}

/** Seed minimal fixtures used across P0 API tests. */
export async function seedFixtures(ctx: TestContext): Promise<void> {
  const now = '2026-09-03T00:00:00.000Z'
  const { d1 } = ctx
  const pw = await hashPassword(SEED_USER.password)
  d1.exec(`INSERT INTO users (id,name,email,password_hash,role,is_active,created_at,updated_at)
    VALUES ('usr-001','SewaTop Admin','${SEED_USER.email}','${pw}','SUPER_ADMIN',1,'${now}','${now}')`)
  d1.exec(`INSERT INTO laptops (id,name,brand,model,category,daily_rate,weekly_rate,monthly_rate,status,slug,quantity,created_at,updated_at)
    VALUES ('lpt-001','Lenovo ThinkPad X280','Lenovo','ThinkPad X280','Business',175000,875000,2400000,'Available','lenovo-thinkpad-x280',1,'${now}','${now}')`)
  d1.exec(`INSERT INTO laptops (id,name,brand,model,category,daily_rate,weekly_rate,monthly_rate,status,slug,quantity,created_at,updated_at)
    VALUES ('lpt-002','MacBook Pro 2019','Apple','MacBook Pro 2019','Designer',175000,875000,2400000,'Available','macbook-pro-2019',1,'${now}','${now}')`)
  d1.exec(`INSERT INTO customers (id,name,phone,is_blacklisted,created_at,updated_at)
    VALUES ('cus-001','Budi Santoso','+62821111111',0,'${now}','${now}')`)
}

/**
 * Dispatch a Request through the Hono app with the given env.
 * Returns the Response (caller asserts status + json body).
 */
export async function request(
  ctx: TestContext,
  method: string,
  path: string,
  init: { headers?: Record<string, string>; body?: unknown } = {},
): Promise<Response> {
  const headers = new Headers(init.headers ?? {})
  let body: BodyInit | undefined
  if (init.body !== undefined) {
    if (typeof init.body === 'string') {
      body = init.body
    } else {
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
      body = JSON.stringify(init.body)
    }
  }
  const req = new Request(`http://localhost${path}`, { method, headers, body })
  return app.fetch(req, ctx.env, {} as ExecutionContext)
}

/** Convenience: assert status + return parsed JSON. */
export async function json(
  ctx: TestContext,
  method: string,
  path: string,
  init: Parameters<typeof request>[3] = {},
): Promise<{ res: Response; body: any }> {
  const res = await request(ctx, method, path, init)
  const body = await res.json().catch(() => null)
  return { res, body }
}
