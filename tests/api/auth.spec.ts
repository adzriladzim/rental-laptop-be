import { describe, it, expect, beforeEach } from 'vitest'
import { newContext, seedFixtures, json, SEED_USER } from './helpers'
import type { TestContext } from './helpers'

// P0: BE Auth.
describe('Auth', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = newContext()
    await seedFixtures(ctx)
  })

  it('POST /auth/login success sets httpOnly cookie + returns user', async () => {
    const { res, body } = await json(ctx, 'POST', '/auth/login', {
      body: { email: SEED_USER.email, password: SEED_USER.password },
    })
    expect(res.status).toBe(200)
    expect(body.data.user.email).toBe(SEED_USER.email)
    expect(body.data.user.role).toBe('SUPER_ADMIN')

    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('token=')
    expect(setCookie.toLowerCase()).toContain('httponly')
    expect(setCookie.toLowerCase()).toContain('samesite=lax') // dev env
  })

  it('POST /auth/login with wrong password -> 401', async () => {
    const { res, body } = await json(ctx, 'POST', '/auth/login', {
      body: { email: SEED_USER.email, password: 'wrongpass' },
    })
    expect(res.status).toBe(401)
    expect(body.error.code).toBe('UNAUTHORIZED')
  })

  it('POST /auth/login with unknown user -> 401', async () => {
    const { res } = await json(ctx, 'POST', '/auth/login', {
      body: { email: 'ghost', password: 'x' },
    })
    expect(res.status).toBe(401)
  })

  it('GET /auth/me without token -> 401', async () => {
    const { res } = await json(ctx, 'GET', '/auth/me')
    expect(res.status).toBe(401)
  })

  it('GET /auth/me with valid cookie returns current user', async () => {
    // Login first to capture cookie.
    const login = await json(ctx, 'POST', '/auth/login', {
      body: { email: SEED_USER.email, password: SEED_USER.password },
    })
    const cookie = login.res.headers.get('set-cookie')!.split(';')[0]

    const { res, body } = await json(ctx, 'GET', '/auth/me', {
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(200)
    expect(body.data.email).toBe(SEED_USER.email)
  })

  it('admin route without token -> 401 (protected)', async () => {
    const { res } = await json(ctx, 'GET', '/laptops')
    expect(res.status).toBe(401)
  })
})
