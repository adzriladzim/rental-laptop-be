// Minimal SQLite DDL mirroring src/db/schema.ts — used to build the in-memory
// fake D1 for API tests. Kept in sync with the schema manually; only tables the
// P0 API tests exercise are declared. Types: text->TEXT, real->REAL, integer->INTEGER.
// ponytail: if a new module's tests need another table/column, add it here.

export const SCHEMA_DDL = /* sql */ `
CREATE TABLE IF NOT EXISTS laptops (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  category TEXT NOT NULL,
  specs TEXT,
  daily_rate REAL NOT NULL,
  weekly_rate REAL,
  monthly_rate REAL,
  status TEXT NOT NULL DEFAULT 'Available',
  slug TEXT NOT NULL UNIQUE,
  photo_url TEXT,
  description TEXT,
  partner_id TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS partners (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  email TEXT,
  id_number TEXT,
  id_type TEXT,
  address TEXT,
  company TEXT,
  is_blacklisted INTEGER NOT NULL DEFAULT 0,
  blacklist_reason TEXT,
  guarantee_doc1 TEXT,
  guarantee_doc2 TEXT,
  home_address TEXT,
  delivery_address TEXT,
  office_address TEXT,
  family_contact TEXT,
  family_contact_relation TEXT,
  family_contact_phone TEXT,
  instagram TEXT,
  linkedin TEXT,
  is_domisili_match INTEGER NOT NULL DEFAULT 0,
  has_own_laptop INTEGER NOT NULL DEFAULT 0,
  referral_code TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  booking_number TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL,
  laptop_id TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  actual_return_date TEXT,
  status TEXT NOT NULL DEFAULT 'Pending',
  payment_status TEXT,
  total_amount REAL NOT NULL,
  late_fee REAL DEFAULT 0,
  damage_fee REAL DEFAULT 0,
  total_penalty REAL DEFAULT 0,
  deposit_amount REAL DEFAULT 0,
  deposit_status TEXT NOT NULL DEFAULT 'none',
  snap_token TEXT,
  notes TEXT,
  rental_reason TEXT,
  referred_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  message TEXT,
  preferred_start TEXT,
  preferred_end TEXT,
  laptop_interest TEXT,
  budget TEXT,
  purpose TEXT,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'New',
  assigned_to TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'IDR',
  method TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  gateway TEXT,
  transaction_id TEXT,
  proof_url TEXT,
  verified_by TEXT,
  verified_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS maintenance_records (
  id TEXT PRIMARY KEY,
  laptop_id TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT,
  cost REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Pending',
  scheduled_date TEXT,
  started_at TEXT,
  completed_at TEXT,
  performed_by TEXT,
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'STAFF',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS token_blacklist (
  jti TEXT PRIMARY KEY,
  user_id TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  laptop_id TEXT NOT NULL,
  rating INTEGER NOT NULL,
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT,
  description TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS packages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  laptop_ids TEXT NOT NULL,
  price REAL NOT NULL,
  duration_days INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pricing_tiers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  min_days INTEGER NOT NULL,
  max_days INTEGER,
  discount_percent REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS laptop_checklists (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL,
  type TEXT NOT NULL,
  checklist_data TEXT NOT NULL,
  damage_fee REAL DEFAULT 0,
  performed_by TEXT,
  created_at TEXT NOT NULL
);
`
