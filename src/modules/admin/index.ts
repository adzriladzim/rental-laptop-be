import { Hono } from 'hono';
import { authMiddleware } from '../../lib/middleware';
import { createLaptopsRouter } from './laptops';
import { createCustomersRouter } from './customers';
import { createBookingsRouter } from './bookings';
import { createLeadsRouter } from './leads';
import { createPartnersRouter } from './partners';
import { createPaymentsRouter } from './payments';
import { createMaintenanceRouter } from './maintenance';
import { createDashboardRouter } from './dashboard';
import type { AppEnv } from '../../env';

export function createAdminRouter(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  // All admin routes require a valid JWT session cookie.
  router.use('*', authMiddleware());

  router.route('/laptops', createLaptopsRouter());
  router.route('/customers', createCustomersRouter());
  router.route('/bookings', createBookingsRouter());
  router.route('/leads', createLeadsRouter());
  router.route('/partners', createPartnersRouter());
  router.route('/payments', createPaymentsRouter());
  router.route('/maintenance', createMaintenanceRouter());
  router.route('/dashboard', createDashboardRouter());

  return router;
}
