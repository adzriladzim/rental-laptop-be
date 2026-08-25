import { Context } from 'hono';

export function parsePagination(c: Context): { page: number; limit: number; offset: number } {
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '20', 10) || 20));
  return { page, limit, offset: (page - 1) * limit };
}

export function listResponse<T>(data: T[], total: number, page: number, limit: number) {
  return {
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}
