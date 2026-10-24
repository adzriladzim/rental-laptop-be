import { describe, it, expect } from 'vitest'
import { daysBetween, calcTotal } from '../../src/lib/booking'
import { buildErrorResponse, UnauthorizedError, NotFoundError, ValidationError } from '../../src/lib/errors'
import { JwtService } from '../../src/lib/jwt'
import { timingSafeEqual } from '../../src/lib/crypto'

describe('lib units', () => {
  it('daysBetween computes inclusive day count', () => {
    expect(daysBetween('2026-09-01', '2026-09-07')).toBe(6)
    expect(daysBetween('2026-09-01', '2026-09-02')).toBe(1)
    expect(daysBetween('2026-09-01', '2026-09-01')).toBe(1)
    expect(daysBetween('2026-09-07', '2026-09-01')).toBe(0) // inverted
  })

  it('calcTotal applies tiered pricing', () => {
    // 1-2 days daily rate
    expect(calcTotal(2, 175000, 875000, 2400000)).toBe(350000)
    // 3-6 days flat 160k/day
    expect(calcTotal(5, 175000, 875000, 2400000)).toBe(800000)
    // weekly (7-29)
    expect(calcTotal(7, 175000, 875000, 2400000)).toBe(875000)
    // monthly (30+)
    expect(calcTotal(30, 175000, 875000, 2400000)).toBe(2400000)
  })

  it('buildErrorResponse maps AppError subclasses', () => {
    expect(buildErrorResponse(new UnauthorizedError()).status).toBe(401)
    expect(buildErrorResponse(new NotFoundError('X')).status).toBe(404)
    expect(buildErrorResponse(new ValidationError('x')).status).toBe(400)
    const r = buildErrorResponse(new UnauthorizedError('nope'))
    expect(r.response.error.code).toBe('UNAUTHORIZED')
  })

  it('jwt sign/verify roundtrip', async () => {
    const svc = new JwtService('secret')
    const { token } = await svc.sign({ userId: 'u1', type: 'admin', role: 'ADMIN' })
    expect(await svc.verify(token)).toBe(true)
    const dec = svc.decode(token)!
    expect(dec.payload.userId).toBe('u1')
    expect(dec.payload.role).toBe('ADMIN')
  })

  it('timingSafeEqual compares constant strings', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true)
    expect(timingSafeEqual('abc', 'abd')).toBe(false)
    expect(timingSafeEqual('ab', 'abc')).toBe(false)
  })
})
