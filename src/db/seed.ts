import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { hashPassword } from '../lib/crypto';
import type { Database } from './index';

// --- Explicit IDs keep relationships simple across SQL generation ---
const now = () => new Date().toISOString();

function q(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  return `'${String(v).replace(/'/g, "''")}'`;
}
const j = (v: unknown) => q(JSON.stringify(v));

interface SeedData {
  partners: Array<Record<string, unknown>>;
  laptops: Array<Record<string, unknown>>;
  users: Array<{ id: string; name: string; email: string; password: string; role: string; isActive: boolean }>;
  customers: Array<Record<string, unknown>>;
  leads: Array<Record<string, unknown>>;
  bookings: Array<Record<string, unknown>>;
  reviews: Array<Record<string, unknown>>;
  packages: Array<Record<string, unknown>>;
}

function buildData(): SeedData {
  const partners = [
    { id: 'ptr-001', name: 'Mitra Teknologi Jakarta', phone: '+62811111111', email: 'mitra1@sewalaptop.id', isActive: true },
    { id: 'ptr-002', name: 'Sahabat Komputer Bandung', phone: '+62812222222', email: 'mitra2@sewalaptop.id', isActive: true },
    { id: 'ptr-003', name: 'Sinergi Digital Surabaya', phone: '+62813333333', email: 'mitra3@sewalaptop.id', isActive: true },
  ];

  // Real units from @sewaintop Instagram. Uniform pricelist: 175k/day (1-2d),
  // 160k/day (3-6d), weekly 875k, monthly 2400k — rates identical for all units.
  const R = { daily: 175000, weekly: 875000, monthly: 2400000 };
  const laptopSeed = [
    { brand: 'Lenovo', model: 'ThinkPad T480', category: 'Developer', name: 'Lenovo ThinkPad T480', slug: 'lenovo-thinkpad-t480', dailyRate: R.daily, weeklyRate: R.weekly, monthlyRate: R.monthly, specs: { processor: 'Intel Core i7-8550U', ram: '16GB', storage: '1TB SSD', battery: 'Berjam-jam' }, partnerId: 'ptr-003', description: 'Kencang, stabil, nyaman. Cocok untuk kerja, editing, kuliah, multitasking berat.' },
    { brand: 'Redmibook', model: 'Redmibook 15', category: 'Student', name: 'Redmibook 15', slug: 'redmibook-15', dailyRate: R.daily, weeklyRate: R.weekly, monthlyRate: R.monthly, specs: { processor: 'Intel Core i3-1115G4', ram: '8GB', storage: '256GB SSD', battery: '7-10 jam' }, partnerId: null, description: 'Ringan dan terjangkau — cocok untuk kuliah, browsing, dan tugas harian.' },
    { brand: 'Lenovo', model: 'ThinkPad T460s', category: 'Business', name: 'Lenovo ThinkPad T460s', slug: 'lenovo-thinkpad-t460s', dailyRate: R.daily, weeklyRate: R.weekly, monthlyRate: R.monthly, specs: { processor: 'Intel Core i7-6600U', ram: '8GB', storage: '256GB SSD', battery: '4-6 jam' }, partnerId: null, description: 'Tipis, ringkas, dan ringan dibawa. Pas untuk kerja kantoran.' },
    { brand: 'Apple', model: 'MacBook Pro 2019', category: 'Designer', name: 'MacBook Pro 2019', slug: 'macbook-pro-2019', dailyRate: R.daily, weeklyRate: R.weekly, monthlyRate: R.monthly, specs: { processor: 'Intel Core i5-8269U', ram: '8GB', storage: '256GB SSD', battery: '5-6 jam' }, partnerId: null, description: 'Layar Retina tajam dan performa kencang untuk editing, desain, dan kerja berat.' },
    { brand: 'Dell', model: 'Latitude 7410', category: 'Business', name: 'Dell Latitude 7410', slug: 'dell-latitude-7410', dailyRate: R.daily, weeklyRate: R.weekly, monthlyRate: R.monthly, specs: { processor: 'Intel Core i7-10610U', ram: '16GB', storage: '512GB SSD', battery: '4-6 jam' }, partnerId: null, description: 'Kelas bisnis dengan layar lega dan baterai awet — ideal untuk profesional.' },
  ];

  const laptops = laptopSeed.map((l, i) => ({
    id: `lpt-${String(i + 1).padStart(3, '0')}`,
    name: l.name,
    brand: l.brand,
    model: l.model,
    category: l.category,
    specs: l.specs,
    dailyRate: l.dailyRate,
    weeklyRate: l.weeklyRate,
    monthlyRate: l.monthlyRate,
    status: 'Available',
    slug: l.slug ?? `${String(l.brand).toLowerCase()}-${String(l.model).toLowerCase()}-${i + 1}`,
    photoUrl: null,
    description: l.description ?? `${l.brand} ${l.model} — ${l.category} laptop for rent.`,
    partnerId: l.partnerId,
  } as Record<string, unknown>));

  const users = [
    { id: 'usr-001', name: 'SewaTop Admin', email: 'sewaintop', password: 'admin123', role: 'SUPER_ADMIN', isActive: true },
    { id: 'usr-002', name: 'Staff Operasional', email: 'staff@sewalaptop.id', password: 'staff123', role: 'STAFF', isActive: true },
  ];

  const customers = [
    { id: 'cus-001', name: 'Budi Santoso', phone: '+62821111111', email: 'budi@example.com', idNumber: '3171xxxx', idType: 'KTP', address: 'Jakarta', company: null, isBlacklisted: false },
    { id: 'cus-002', name: 'Siti Rahayu', phone: '+62822222222', email: 'siti@example.com', idNumber: null, idType: null, address: 'Bandung', company: 'PT Maju', isBlacklisted: false },
    { id: 'cus-003', name: 'Andi Wijaya', phone: '+62823333333', email: null, idNumber: '3571xxxx', idType: 'KTP', address: 'Surabaya', company: null, isBlacklisted: true },
  ];

  const leads = [
    { id: 'lead-001', name: 'Rina', phone: '+62824444444', email: 'rina@example.com', message: 'Butuh laptop untuk WFH 1 bulan', preferredStart: '2026-09-01', preferredEnd: '2026-09-30', laptopInterest: 'Ultrabook', budget: '2jt', purpose: 'WFH', source: 'instagram', status: 'New' },
    { id: 'lead-002', name: 'Dedi', phone: '+62825555555', email: null, message: 'Laptop gaming 2 minggu', preferredStart: '2026-08-15', preferredEnd: '2026-08-29', laptopInterest: 'Gaming', budget: '1.5jt', purpose: 'Main game', source: 'whatsapp', status: 'Contacted' },
    { id: 'lead-003', name: 'Maya', phone: '+62826666666', email: 'maya@example.com', message: 'MacBook untuk editing', preferredStart: '2026-10-01', preferredEnd: '2026-10-10', laptopInterest: 'Creator', budget: '3.5jt', purpose: 'Editing video', source: 'instagram', status: 'Qualified' },
  ];

  const bookings = [
    { id: 'bkg-001', bookingNumber: 'LPR-2026-0001', customerId: 'cus-001', laptopId: 'lpt-001', startDate: '2026-09-01', endDate: '2026-09-07', actualReturnDate: null, status: 'Confirmed', paymentStatus: 'paid', totalAmount: 875000, lateFee: 0, damageFee: 0, totalPenalty: 0, notes: 'Booking via Instagram @sewaintop', snapToken: 'mock-snap-LPR-2026-0001' },
    { id: 'bkg-002', bookingNumber: 'LPR-2026-0002', customerId: 'cus-002', laptopId: 'lpt-003', startDate: '2026-09-10', endDate: '2026-09-17', actualReturnDate: null, status: 'Pending', paymentStatus: 'unpaid', totalAmount: 875000, lateFee: 0, damageFee: 0, totalPenalty: 0, notes: null, snapToken: 'mock-snap-LPR-2026-0002' },
  ];

  const reviews = [
    { id: 'rev-001', customerId: 'cus-001', laptopId: 'lpt-001', rating: 5, comment: 'Laptopnya mulus, baterai awet, cocok banget buat kerja remote seminggu. Proses sewa cepat dan CS-nya responsif.', status: 'approved' },
    { id: 'rev-002', customerId: 'cus-002', laptopId: 'lpt-004', rating: 4, comment: 'MacBook-nya ngebut buat desain, layar Retina tajam. Pengiriman tepat waktu, cuma minus unit agak sedikit baret di bodi.', status: 'approved' },
    { id: 'rev-003', customerId: 'cus-003', laptopId: 'lpt-003', rating: 5, comment: 'ThinkPad T460s ringan dibawa ke mana-mana, baterai seharian. Proses pengembalian gampang, dana jaminan cair cepat.', status: 'approved' },
  ];

  const packages = [
    { id: 'pkg-001', name: 'Paket Ujian BUMN', description: 'Paket laptop siap ujian online BUMN, sudah terpasang browser ujian dan stabil untuk tes CAT.', laptopIds: ['lpt-001', 'lpt-005'], price: 2000000, durationDays: 7, isActive: true },
    { id: 'pkg-002', name: 'Paket Kerja Remote', description: 'Paket laptop performa tinggi untuk kerja remote, edge computing ringan, dan video conference sepanjang hari.', laptopIds: ['lpt-003', 'lpt-004'], price: 3000000, durationDays: 14, isActive: true },
  ];

  return { partners, laptops, users, customers, leads, bookings, reviews, packages };
}

export async function buildSeedSql(): Promise<string> {
  const data = buildData();
  const ts = now();
  const lines: string[] = [];

  const insert = (table: string, cols: string[], rows: Array<Record<string, unknown>>, valueFor: (k: string, v: unknown, ts: string, row: Record<string, unknown>) => string) => {
    for (const row of rows) {
      const vals = cols.map((col) => valueFor(col, row[col], ts, row));
      lines.push(`INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${vals.join(', ')});`);
    }
  };

  insert('partners', ['id', 'name', 'phone', 'email', 'is_active', 'created_at', 'updated_at'],
    data.partners as any, (k, v, _ts, row) => {
      if (k.endsWith('_at')) return q(ts);
      if (k === 'is_active') return q(row['isActive'] ?? true);
      return q(v);
    });

  // Laptops need password-free hashing path; specs as JSON.
  for (const l of data.laptops) {
    lines.push(
      `INSERT OR IGNORE INTO laptops (id, name, brand, model, category, specs, daily_rate, weekly_rate, monthly_rate, status, slug, photo_url, description, partner_id, created_at, updated_at) VALUES (${q(l.id)}, ${q(l.name)}, ${q(l.brand)}, ${q(l.model)}, ${q(l.category)}, ${j(l.specs)}, ${q(l.dailyRate)}, ${q(l.weeklyRate)}, ${q(l.monthlyRate)}, ${q(l.status)}, ${q(l.slug)}, ${q(l.photoUrl)}, ${q(l.description)}, ${q(l.partnerId)}, ${q(ts)}, ${q(ts)});`,
    );
  }

  for (const u of data.users) {
    const hash = await hashPassword(u.password);
    lines.push(
      `INSERT OR IGNORE INTO users (id, name, email, password_hash, role, is_active, created_at, updated_at) VALUES (${q(u.id)}, ${q(u.name)}, ${q(u.email)}, ${q(hash)}, ${q(u.role)}, ${q(u.isActive)}, ${q(ts)}, ${q(ts)});`,
    );
  }

  // camelCase → snake_case lookup helper (seed objects use camelCase, SQL uses snake_case)
  const camelToSnake: Record<string, string> = {
    id_number: 'idNumber', id_type: 'idType', is_blacklisted: 'isBlacklisted',
    preferred_start: 'preferredStart', preferred_end: 'preferredEnd',
    laptop_interest: 'laptopInterest', customer_id: 'customerId', laptop_id: 'laptopId',
    booking_number: 'bookingNumber', start_date: 'startDate', end_date: 'endDate',
    actual_return_date: 'actualReturnDate', payment_status: 'paymentStatus',
    total_amount: 'totalAmount', late_fee: 'lateFee', damage_fee: 'damageFee',
    total_penalty: 'totalPenalty', snap_token: 'snapToken',
    customer_id: 'customerId', laptop_id: 'laptopId',
    laptop_ids: 'laptopIds', duration_days: 'durationDays', is_active: 'isActive',
  };
  const rowVal = (col: string, row: Record<string, unknown>, ts: string) => {
    const v = row[camelToSnake[col] ?? col];
    return col.endsWith('_at') ? q(ts) : col === 'is_blacklisted' ? q(v) : q(v);
  };

  insert('customers', ['id', 'name', 'phone', 'email', 'id_number', 'id_type', 'address', 'company', 'is_blacklisted', 'created_at', 'updated_at'],
    data.customers as any, (k, v) => (k.endsWith('_at') ? q(ts) : k === 'is_blacklisted' ? q(v ?? false) : q(v)));

  insert('leads', ['id', 'name', 'phone', 'email', 'message', 'preferred_start', 'preferred_end', 'laptop_interest', 'budget', 'purpose', 'source', 'status', 'created_at', 'updated_at'],
    data.leads as any, (k, v) => (k.endsWith('_at') ? q(ts) : q(v)));

  insert('bookings', ['id', 'booking_number', 'customer_id', 'laptop_id', 'start_date', 'end_date', 'actual_return_date', 'status', 'payment_status', 'total_amount', 'late_fee', 'damage_fee', 'total_penalty', 'snap_token', 'notes', 'created_at', 'updated_at'],
    data.bookings as any, (k, _v, _ts, row) => rowVal(k, row, ts));

  // Reviews — plain text fields, camelCase→snake via rowVal.
  insert('reviews', ['id', 'customer_id', 'laptop_id', 'rating', 'comment', 'status', 'created_at', 'updated_at'],
    data.reviews as any, (k, _v, _ts, row) => rowVal(k, row, ts));

  // Packages — laptop_ids JSON, is_active boolean→int, rest via rowVal.
  insert('packages', ['id', 'name', 'description', 'laptop_ids', 'price', 'duration_days', 'is_active', 'created_at', 'updated_at'],
    data.packages as any, (k, _v, _ts, row) => {
      if (k === 'laptop_ids') return j(row['laptopIds']);
      if (k === 'is_active') return q(row['isActive'] ?? true);
      return rowVal(k, row, ts);
    });

  return lines.join('\n') + '\n';
}

// In-worker seeding (idempotent). Useful from a one-off admin route / cron.
export async function seedDatabase(db: Database): Promise<void> {
  const data = buildData();
  const ts = now();
  await db.insert(partners).values(data.partners as any).onConflictDoNothing();
  await db.insert(laptops).values(data.laptops as any).onConflictDoNothing();
  const users = await Promise.all(
    data.users.map(async (u) => ({ ...u, passwordHash: await hashPassword(u.password), password: undefined })),
  );
  await db.insert(usersTable).values(users.map(({ id, name, email, passwordHash, role, isActive }) => ({ id, name, email, passwordHash, role, isActive })) as any).onConflictDoNothing();
  await db.insert(customersTable).values(data.customers as any).onConflictDoNothing();
  await db.insert(leadsTable).values(data.leads as any).onConflictDoNothing();
  await db.insert(bookingsTable).values(data.bookings as any).onConflictDoNothing();
  await db.insert(reviewsTable).values(data.reviews as any).onConflictDoNothing();
  await db.insert(packagesTable).values(data.packages as any).onConflictDoNothing();
}

// tsx entry: generate seed.sql for `wrangler d1 execute --file`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildSeedSql()
    .then((sql) => {
      writeFileSync('seed.sql', sql);
      console.log('Wrote seed.sql');
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

// Imported lazily to avoid pulling schema types at top in the tsx-file branch.
import { partners, laptops, customers as customersTable, leads as leadsTable, bookings as bookingsTable, users as usersTable, reviews as reviewsTable, packages as packagesTable } from './schema';
