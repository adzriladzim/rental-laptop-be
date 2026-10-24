import { describe, it, expect, beforeEach } from 'vitest'
import { newContext, seedFixtures, json, request } from './helpers'
import type { TestContext } from './helpers'

// P0: BE Public API.
// API key = lpr_public_dev_key (dev). Validated via X-API-Key header.

const KEY = { 'X-API-Key': 'lpr_public_dev_key' }

// Booking validation rejects past dates, so derive fixtures from today
// instead of hardcoding calendar dates that rot as time moves on.
const futureDate = (daysAhead: number) =>
  new Date(Date.now() + daysAhead * 86400000).toISOString().slice(0, 10)

describe('Public API', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = newContext()
    await seedFixtures(ctx)
  })

  it('GET /public/laptops returns seeded laptops', async () => {
    const { res, body } = await json(ctx, 'GET', '/public/laptops', { headers: KEY })
    expect(res.status).toBe(200)
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data.length).toBeGreaterThanOrEqual(2)
    const l = body.data.find((x: any) => x.slug === 'lenovo-thinkpad-x280')
    expect(l).toBeTruthy()
    expect(l.brand).toBe('Lenovo')
    expect(l.dailyRate).toBe(175000)
  })

  it('GET /public/laptops without API key -> 401', async () => {
    const { res } = await json(ctx, 'GET', '/public/laptops')
    expect(res.status).toBe(401)
    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('GET /public/laptops with wrong API key -> 401', async () => {
    const { res } = await json(ctx, 'GET', '/public/laptops', {
      headers: { 'X-API-Key': 'wrong-key' },
    })
    expect(res.status).toBe(401)
  })

  it('GET /public/laptops/:slug returns a single laptop', async () => {
    const { res, body } = await json(ctx, 'GET', '/public/laptops/macbook-pro-14-m2-pro', {
      headers: KEY,
    })
    expect(res.status).toBe(200)
    expect(body.data.slug).toBe('macbook-pro-14-m2-pro')
    expect(body.data.category).toBe('Designer')
  })

  it('GET /public/laptops/:slug unknown -> 404', async () => {
    const { res } = await json(ctx, 'GET', '/public/laptops/nope', { headers: KEY })
    expect(res.status).toBe(404)
  })

  it('GET /public/availability returns available laptops', async () => {
    const start = '2026-09-10'
    const end = '2026-09-12'
    const { res, body } = await json(
      ctx,
      'GET',
      `/public/availability?startDate=${start}&endDate=${end}`,
      { headers: KEY },
    )
    expect(res.status).toBe(200)
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data.length).toBeGreaterThanOrEqual(2)
  })

  it('GET /public/availability rejects endDate before startDate', async () => {
    const { res } = await json(
      ctx,
      'GET',
      '/public/availability?startDate=2026-09-12&endDate=2026-09-10',
      { headers: KEY },
    )
    expect(res.status).toBe(400)
  })

  it('GET /public/laptops/:slug/booked-dates returns date array', async () => {
    const { res, body } = await json(
      ctx,
      'GET',
      '/public/laptops/lenovo-thinkpad-x280/booked-dates?start=2026-09-01&end=2026-09-30',
      { headers: KEY },
    )
    expect(res.status).toBe(200)
    expect(body.data.dates).toBeDefined()
    expect(Array.isArray(body.data.dates)).toBe(true)
  })

  it('POST /public/bookings creates a booking (14-field payload)', async () => {
    const payload = {
      laptopSlug: 'lenovo-thinkpad-x280',
      startDate: futureDate(7),
      endDate: futureDate(9),
      customerName: 'QA Budi',
      customerPhone: '+62821111111',
      homeAddress: 'Jl. Test 1, Jakarta',
      deliveryAddress: 'Jakarta Selatan',
      officeAddress: 'Jakarta Pusat',
      guaranteeDoc1: 'KTP',
      guaranteeDoc2: 'SIM',
      rentalReason: 'Ujian sertifikasi',
      familyContactRelation: 'Orang Tua',
      familyContactPhone: '081298765432',
      instagram: 'qa_budi',
      linkedin: 'linkedin.com/in/qabudi',
      isDomisiliMatch: true,
      hasOwnLaptop: false,
    }
    const { res, body } = await json(ctx, 'POST', '/public/bookings', {
      headers: KEY,
      body: payload,
    })
    expect(res.status).toBe(201)
    expect(body.data.bookingNumber).toMatch(/^LPR-\d{4}-\d{4}$/)
    expect(body.data.status).toBe('Pending')
    expect(body.data.paymentStatus).toBe('unpaid')
    expect(body.data.laptop.slug).toBe('lenovo-thinkpad-x280')
    expect(body.data.totalAmount).toBeGreaterThan(0)
  })

  it('POST /public/bookings rejects missing required fields', async () => {
    const { res } = await json(ctx, 'POST', '/public/bookings', {
      headers: KEY,
      body: { laptopSlug: 'lenovo-thinkpad-x280' },
    })
    expect(res.status).toBe(400)
  })

  it('POST /public/bookings rejects unknown laptop -> 404', async () => {
    const { res } = await json(ctx, 'POST', '/public/bookings', {
      headers: KEY,
      body: {
        laptopSlug: 'ghost-laptop',
        startDate: futureDate(7),
        endDate: futureDate(9),
        customerName: 'X',
        customerPhone: '+62800000000',
        guaranteeDoc1: 'KTP',
        guaranteeDoc2: 'SIM',
      },
    })
    expect(res.status).toBe(404)
  })

  it('POST /public/bookings rejects blacklisted customer -> 403', async () => {
    // Mark existing customer blacklisted.
    ctx.d1.exec("UPDATE customers SET is_blacklisted = 1 WHERE id = 'cus-001'")
    const { res } = await json(ctx, 'POST', '/public/bookings', {
      headers: KEY,
      body: {
        laptopSlug: 'lenovo-thinkpad-x280',
        startDate: futureDate(7),
        endDate: futureDate(9),
        customerName: 'Budi Santoso',
        customerPhone: '+62821111111',
        guaranteeDoc1: 'KTP',
        guaranteeDoc2: 'SIM',
      },
    })
    expect(res.status).toBe(403)
  })

  it('GET /public/bookings/:bookingNumber/status unknown -> 404', async () => {
    const { res } = await json(ctx, 'GET', '/public/bookings/LPR-9999-9999/status', {
      headers: KEY,
    })
    expect(res.status).toBe(404)
  })
})
