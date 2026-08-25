import { Context, Next } from 'hono';
import { z } from 'zod';
import { ValidationError } from './errors';

export function validateBody<T>(schema: z.ZodType<T>) {
  return async (c: Context, next: Next) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw new ValidationError('Invalid JSON body');
    }
    const result = schema.safeParse(body ?? {});
    if (!result.success) {
      throw new ValidationError(
        result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
      );
    }
    c.set('validatedBody', result.data);
    await next();
  };
}

export function validateQuery<T>(schema: z.ZodType<T>) {
  return async (c: Context, next: Next) => {
    const result = schema.safeParse(c.req.query());
    if (!result.success) {
      throw new ValidationError(
        result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
      );
    }
    c.set('validatedQuery', result.data);
    await next();
  };
}

export function getBody<T>(c: Context): T {
  return c.get('validatedBody') as T;
}

export function getQuery<T>(c: Context): T {
  return c.get('validatedQuery') as T;
}
