import jwt from '@tsndr/cloudflare-worker-jwt';
import type { Role } from '../env';

export interface JwtPayload {
  userId: string;
  type: 'admin';
  role: Role;
  jti: string;
  iat?: number;
  exp?: number;
}

export class JwtService {
  constructor(private secret: string) {}

  async sign(
    payload: Omit<JwtPayload, 'iat' | 'exp' | 'jti'>,
    expiresInDays = 7,
  ): Promise<{ token: string; jti: string; exp: number }> {
    const jti = crypto.randomUUID();
    const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * expiresInDays;
    const token = await jwt.sign({ ...payload, jti, exp }, this.secret);
    return { token, jti, exp };
  }

  async verify(token: string): Promise<boolean> {
    return (await jwt.verify(token, this.secret)) !== undefined;
  }

  decode(token: string): { payload: JwtPayload } | null {
    try {
      return jwt.decode(token) as { payload: JwtPayload };
    } catch {
      return null;
    }
  }
}
