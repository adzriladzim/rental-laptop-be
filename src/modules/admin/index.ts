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
import { createChecklistsRouter } from './checklists';
import { createReportsRouter } from './reports';
import { createReviewsRouter } from './reviews';
import { createPackagesRouter } from './packages';
import { createPricingRouter } from './pricing';
import { createSettingsRouter } from './settings';
import { createUsersRouter } from './users';
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
  router.route('/checklists', createChecklistsRouter());
  router.route('/reports', createReportsRouter());
  router.route('/reviews', createReviewsRouter());
  router.route('/packages', createPackagesRouter());
  router.route('/pricing-tiers', createPricingRouter());
  router.route('/settings', createSettingsRouter());
  router.route('/users', createUsersRouter());

  return router;
}
