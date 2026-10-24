import { describe, it, expect, beforeEach } from 'vitest'
import { newContext, seedFixtures, json, request } from './helpers'
import type { TestContext } from './helpers'
import { createHmac } from 'node:crypto'

// P0: BE Webhook — signature verification (HMAC-SHA256 hex, timing-safe).
// Header accepted: X-Callback-Signature or X-Signature.
const SECRET = 'dev-webhook-secret'

function sign(raw: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(raw).digest('hex')
}

describe('Webhook', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = newContext()
    await seedFixtures(ctx)
  })

  it('rejects request with no signature header -> 401', async () => {
    const res = await request(ctx, 'POST', '/webhooks/payment/notification', {
      body: { orderId: 'LPR-2026-0001', transactionStatus: 'settlement' },
    })
    expect(res.status).toBe(401)
  })

  it('rejects invalid signature -> 401', async () => {
    const raw = JSON.stringify({ orderId: 'LPR-2026-0001', transactionStatus: 'settlement' })
    const res = await request(ctx, 'POST', '/webhooks/payment/notification', {
      headers: { 'X-Callback-Signature': 'deadbeef'.repeat(8) },
      body: raw,
    })
    expect(res.status).toBe(401)
  })

  it('rejects valid signature for unknown booking -> 404', async () => {
    const payload = { orderId: 'LPR-9999-0001', transactionStatus: 'settlement' }
    const raw = JSON.stringify(payload)
    const res = await request(ctx, 'POST', '/webhooks/payment/notification', {
      headers: { 'X-Callback-Signature': sign(raw) },
      body: raw,
    })
    expect(res.status).toBe(404)
  })

  it('accepts valid signature for a known booking and marks it paid', async () => {
    // Seed a Pending booking.
    ctx.d1.exec(`INSERT INTO bookings (id,booking_number,customer_id,laptop_id,start_date,end_date,status,payment_status,total_amount,created_at,updated_at)
      VALUES ('bkg-001','LPR-2026-0001','cus-001','lpt-001','2026-09-01','2026-09-07','Pending','unpaid',875000,'2026-09-03T00:00:00.000Z','2026-09-03T00:00:00.000Z')`)

    const payload = {
      orderId: 'LPR-2026-0001',
      transactionStatus: 'settlement',
      paymentType: 'bank_transfer',
      grossAmount: 875000,
    }
    const raw = JSON.stringify(payload)
    const { res, body } = await json(ctx, 'POST', '/webhooks/payment/notification', {
      headers: { 'X-Callback-Signature': sign(raw) },
      body: payload,
    })
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
  })
})
