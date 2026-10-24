# API Tests (BE)

Vitest test suite untuk backend Sewaintop (Cloudflare Workers + Hono + D1).

Tests run **in-process** against the Hono `app` (exported from `src/index.ts`) with an
in-memory SQLite (built-in `node:sqlite`, Node 22.5+) standing in for D1. No running
`wrangler dev` required — `npm test` is fully self-contained.

## Jalankan

```bash
npm test           # sekali jalan (vitest run)
npm run test:watch # watch mode
```

## Struktur

```
tests/api/
  fake-d1.ts        # in-memory D1 adapter (node:sqlite) → drizzle d1 driver surface
  schema-ddl.ts     # DDL cerminan src/db/schema.ts (hanya tabel yang diuji)
  helpers.ts        # build Env, seed fixtures, app.request() wrapper
  public.spec.ts    # GET /public/laptops, availability, booked-dates, POST bookings, 401 API key
  auth.spec.ts      # login success/fail, cookie httpOnly/SameSite, /me 401, admin protected
  webhook.spec.ts   # payment notification: signature valid/invalid/unknown
  lib.spec.ts       # daysBetween, calcTotal, errors mapping, jwt roundtrip, timingSafeEqual
```

## Cara kerja `fake-d1.ts`

Drizzle D1 driver memanggil `d1.prepare(sql) -> bind(...params) -> { all(), raw(), run(), first() }`.
`fake-d1.ts` mengimplementasikan surface itu di atas `node:sqlite`, menormalkan
identifiers backtick (Cloudflare) → double-quote (SQLite). `node:sqlite` bersifat
experimental — warning di log adalah normal.

## Catatan penting

- Public API butuh header `X-API-Key` (`lpr_public_dev_key` di dev).
- Seed user: `sewaintop` / `admin123` (SUPER_ADMIN) — password di-hash di setup via
  `hashPassword` (PBKDF2 WebCrypto), bukan hash hardcode.
- `fake-d1.ts` adalah adapter SQL subset; bila test baru menyentuh query kompleks
  (subquery correlated, batch transaction) yang tidak didukung, periksa `fake-d1.ts`.
