import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Laptops
export const laptops = sqliteTable('laptops', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  brand: text('brand').notNull(),
  model: text('model').notNull(),
  category: text('category').notNull(),
  specs: text('specs', { mode: 'json' }),
  dailyRate: real('daily_rate').notNull(),
  weeklyRate: real('weekly_rate'),
  monthlyRate: real('monthly_rate'),
  status: text('status', { enum: ['Available', 'Rented', 'Maintenance', 'Inactive'] }).notNull().default('Available'),
  slug: text('slug').notNull().unique(),
  photoUrl: text('photo_url'),
  description: text('description'),
  partnerId: text('partner_id').references(() => partners.id),
  quantity: integer('quantity').notNull().default(1),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({
  statusIdx: index('laptops_status_idx').on(t.status),
  categoryIdx: index('laptops_category_idx').on(t.category),
  slugIdx: index('laptops_slug_idx').on(t.slug),
}));

// Partners
export const partners = sqliteTable('partners', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({ activeIdx: index('partners_active_idx').on(t.isActive) }));

// Customers
export const customers = sqliteTable('customers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  phone: text('phone').notNull().unique(),
  email: text('email'),
  idNumber: text('id_number'),
  idType: text('id_type'),
  address: text('address'),
  company: text('company'),
  isBlacklisted: integer('is_blacklisted', { mode: 'boolean' }).notNull().default(false),
  blacklistReason: text('blacklist_reason'),
  guaranteeDoc1: text('guarantee_doc1'),
  guaranteeDoc2: text('guarantee_doc2'),
  homeAddress: text('home_address'),
  deliveryAddress: text('delivery_address'),
  officeAddress: text('office_address'),
  familyContact: text('family_contact'),
  familyContactRelation: text('family_contact_relation'),
  familyContactPhone: text('family_contact_phone'),
  instagram: text('instagram'),
  linkedin: text('linkedin'),
  isDomisiliMatch: integer('is_domisili_match', { mode: 'boolean' }).notNull().default(false),
  hasOwnLaptop: integer('has_own_laptop', { mode: 'boolean' }).notNull().default(false),
  referralCode: text('referral_code').unique(),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({ phoneIdx: index('customers_phone_idx').on(t.phone) }));

// Bookings
export const bookings = sqliteTable('bookings', {
  id: text('id').primaryKey(),
  bookingNumber: text('booking_number').notNull().unique(),
  customerId: text('customer_id').notNull().references(() => customers.id),
  laptopId: text('laptop_id').notNull().references(() => laptops.id),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  actualReturnDate: text('actual_return_date'),
  status: text('status', {
    enum: ['Pending', 'pending_payment', 'Confirmed', 'Active', 'Completed', 'Cancelled', 'expired', 'refunded'],
  }).notNull().default('Pending'),
  paymentStatus: text('payment_status'),
  totalAmount: real('total_amount').notNull(),
  lateFee: real('late_fee').default(0),
  damageFee: real('damage_fee').default(0),
  totalPenalty: real('total_penalty').default(0),
  depositAmount: real('deposit_amount').default(0),
  depositStatus: text('deposit_status', { enum: ['none', 'held', 'refunded', 'forfeited'] })
    .notNull()
    .default('none'),
  snapToken: text('snap_token'),
  notes: text('notes'),
  rentalReason: text('rental_reason'),
  referredBy: text('referred_by'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({
  customerIdx: index('bookings_customer_idx').on(t.customerId),
  laptopIdx: index('bookings_laptop_idx').on(t.laptopId),
  statusIdx: index('bookings_status_idx').on(t.status),
  datesIdx: index('bookings_dates_idx').on(t.startDate, t.endDate),
  numberIdx: index('bookings_number_idx').on(t.bookingNumber),
}));

// Leads
export const leads = sqliteTable('leads', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  message: text('message'),
  preferredStart: text('preferred_start'),
  preferredEnd: text('preferred_end'),
  laptopInterest: text('laptop_interest'),
  budget: text('budget'),
  purpose: text('purpose'),
  source: text('source'),
  status: text('status', { enum: ['New', 'Contacted', 'Qualified', 'Converted', 'Lost'] }).notNull().default('New'),
  assignedTo: text('assigned_to'),
  notes: text('notes'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({ statusIdx: index('leads_status_idx').on(t.status) }));

// Payments
export const payments = sqliteTable('payments', {
  id: text('id').primaryKey(),
  bookingId: text('booking_id').notNull().references(() => bookings.id),
  amount: real('amount').notNull(),
  currency: text('currency').notNull().default('IDR'),
  method: text('method'),
  status: text('status', { enum: ['pending', 'verified', 'rejected', 'refunded'] }).notNull().default('pending'),
  gateway: text('gateway'),
  transactionId: text('transaction_id'),
  proofUrl: text('proof_url'),
  verifiedBy: text('verified_by'),
  verifiedAt: text('verified_at'),
  notes: text('notes'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({
  bookingIdx: index('payments_booking_idx').on(t.bookingId),
  statusIdx: index('payments_status_idx').on(t.status),
}));

// Maintenance records
export const maintenanceRecords = sqliteTable('maintenance_records', {
  id: text('id').primaryKey(),
  laptopId: text('laptop_id').notNull().references(() => laptops.id),
  type: text('type', { enum: ['Scheduled', 'Repair', 'Upgrade', 'Cleaning', 'Inspection'] }).notNull(),
  description: text('description'),
  cost: real('cost').default(0),
  status: text('status', { enum: ['Pending', 'InProgress', 'Completed', 'Cancelled'] }).notNull().default('Pending'),
  scheduledDate: text('scheduled_date'),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  performedBy: text('performed_by'),
  notes: text('notes'),
  createdBy: text('created_by'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({
  laptopIdx: index('maintenance_laptop_idx').on(t.laptopId),
  statusIdx: index('maintenance_status_idx').on(t.status),
}));

// Laptop handover checklists (digital serah terima)
export const laptopChecklists = sqliteTable('laptop_checklists', {
  id: text('id').primaryKey(),
  bookingId: text('booking_id').notNull().references(() => bookings.id),
  type: text('type', { enum: ['pickup', 'return'] }).notNull(),
  checklistData: text('checklist_data').notNull(), // JSON string
  damageFee: real('damage_fee').default(0),
  performedBy: text('performed_by'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({
  bookingIdx: index('checklists_booking_idx').on(t.bookingId),
  typeIdx: index('checklists_type_idx').on(t.type),
  bookingTypeUnique: uniqueIndex('checklists_booking_type_unique').on(t.bookingId, t.type),
}));

// Users
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['SUPER_ADMIN', 'ADMIN', 'STAFF'] }).notNull().default('STAFF'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({
  roleIdx: index('users_role_idx').on(t.role),
  activeIdx: index('users_active_idx').on(t.isActive),
}));

// Token blacklist
export const tokenBlacklist = sqliteTable('token_blacklist', {
  jti: text('jti').primaryKey(),
  userId: text('user_id'),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({ expIdx: index('token_blacklist_exp_idx').on(t.expiresAt) }));

// Reviews
export const reviews = sqliteTable('reviews', {
  id: text('id').primaryKey(),
  customerId: text('customer_id').notNull().references(() => customers.id),
  laptopId: text('laptop_id').notNull().references(() => laptops.id),
  rating: integer('rating').notNull(),
  comment: text('comment'),
  status: text('status', { enum: ['pending', 'approved', 'rejected'] }).notNull().default('pending'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({
  statusIdx: index('reviews_status_idx').on(t.status),
  customerIdx: index('reviews_customer_idx').on(t.customerId),
  laptopIdx: index('reviews_laptop_idx').on(t.laptopId),
}));

// System config
export const systemConfig = sqliteTable('system_config', {
  key: text('key').primaryKey(),
  value: text('value'),
  description: text('description'),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

// Packages — curated bundle of laptops sold as a unit.
export const packages = sqliteTable('packages', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  laptopIds: text('laptop_ids', { mode: 'json' }).$type<string[]>().notNull(),
  price: real('price').notNull(),
  durationDays: integer('duration_days').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({ activeIdx: index('packages_active_idx').on(t.isActive) }));

// Pricing tiers — duration based discounts.
export const pricingTiers = sqliteTable('pricing_tiers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  minDays: integer('min_days').notNull(),
  maxDays: integer('max_days'),
  discountPercent: real('discount_percent').notNull().default(0),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export type Laptop = typeof laptops.$inferSelect;
export type NewLaptop = typeof laptops.$inferInsert;
export type Partner = typeof partners.$inferSelect;
export type NewPartner = typeof partners.$inferInsert;
export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
export type MaintenanceRecord = typeof maintenanceRecords.$inferSelect;
export type NewMaintenanceRecord = typeof maintenanceRecords.$inferInsert;
export type LaptopChecklist = typeof laptopChecklists.$inferSelect;
export type NewLaptopChecklist = typeof laptopChecklists.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type TokenBlacklistEntry = typeof tokenBlacklist.$inferSelect;
export type SystemConfig = typeof systemConfig.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;
export type Package = typeof packages.$inferSelect;
export type NewPackage = typeof packages.$inferInsert;
export type PricingTier = typeof pricingTiers.$inferSelect;
export type NewPricingTier = typeof pricingTiers.$inferInsert;
