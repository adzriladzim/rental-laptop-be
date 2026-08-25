import { Hono, Context } from 'hono';
import { setCookie, getCookie } from 'hono/cookie';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { createDb } from '../db';
import { users, tokenBlacklist } from '../db/schema';
import { JwtService } from '../lib/jwt';
import { verifyPassword } from '../lib/crypto';
import { UnauthorizedError, NotFoundError } from '../lib/errors';
import { authMiddleware } from '../lib/middleware';
import { validateBody, getBody } from '../lib/validate';
import type { AppEnv, Role } from '../env';

const loginSchema = z.object({
  // Username OR email — admin prefers plain username (e.g. "sewaintop")
  email: z.string().min(3, 'Username minimal 3 karakter'),
  password: z.string().min(1, 'Password is required'),
});

type LoginRequest = z.infer<typeof loginSchema>;

function isProd(c: Context<AppEnv>): boolean {
  return c.env.ENVIRONMENT === 'production';
}

async function findUserByEmail(db: ReturnType<typeof createDb>, email: string) {
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return rows[0] ?? null;
}

async function findUserById(db: ReturnType<typeof createDb>, id: string) {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

export function createAuthRouter(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  // POST /auth/login
  router.post('/login', validateBody(loginSchema), async (c) => {
    const { email, password } = getBody<LoginRequest>(c);
    const db = createDb(c.env.DB);
    const user = await findUserByEmail(db, email);
    if (!user) throw new UnauthorizedError('Invalid credentials');
    if (!user.isActive) throw new UnauthorizedError('Account is deactivated');
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) throw new UnauthorizedError('Invalid credentials');

    const jwtService = new JwtService(c.env.JWT_SECRET);
    const { token } = await jwtService.sign({
      userId: user.id,
      type: 'admin',
      role: user.role as Role,
    });

    setCookie(c, 'token', token, {
      httpOnly: true,
      secure: isProd(c),
      sameSite: 'None',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    });

    return c.json({
      data: { user: { id: user.id, name: user.name, email: user.email, role: user.role } },
    });
  });

  // GET /auth/me
  router.get('/me', authMiddleware(), async (c) => {
    const authUser = c.get('user');
    if (!authUser) throw new UnauthorizedError('Not authenticated');
    const db = createDb(c.env.DB);
    const user = await findUserById(db, authUser.userId);
    if (!user) throw new NotFoundError('User');
    return c.json({
      data: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  });

  // POST /auth/logout
  router.post('/logout', authMiddleware(), async (c) => {
    const token = getCookie(c, 'token');
    if (token) {
      try {
        const db = createDb(c.env.DB);
        const jwtService = new JwtService(c.env.JWT_SECRET);
        const decoded = jwtService.decode(token);
        const payload = decoded?.payload;
        if (payload && payload.jti && payload.exp) {
          await db.insert(tokenBlacklist).values({
            jti: payload.jti,
            userId: payload.userId,
            expiresAt: new Date(payload.exp * 1000).toISOString(),
          }).onConflictDoNothing();
        }
      } catch (error) {
        console.error('Failed to blacklist token:', error);
      }
    }

    setCookie(c, 'token', '', {
      httpOnly: true,
      secure: isProd(c),
      sameSite: 'None',
      maxAge: 0,
      path: '/',
    });
    return c.json({ message: 'Logged out successfully' });
  });

  return router;
}
