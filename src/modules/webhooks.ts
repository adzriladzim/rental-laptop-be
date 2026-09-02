import { Hono, Context } from 'hono';
import { eq, and } from 'drizzle-orm';
import { createDb } from '../db';
import { bookings, payments } from '../db/schema';
import { timingSafeEqual } from '../lib/crypto';
import { UnauthorizedError, NotFoundError } from '../lib/errors';
import type { AppEnv } from '../env';

const PAID_STATUSES = ['settlement', 'capture', 'paid'];
const FAILED_STATUSES = ['expire', 'cancel', 'deny', 'failure'];

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function verifySignature(rawBody: string, headerSig: string | undefined, secret: string): Promise<boolean> {
  if (!headerSig) return Promise.resolve(false);
  return hmacHex(secret, rawBody).then((expected) => timingSafeEqual(expected, headerSig));
}

export function createWebhookRouter(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  // Signature-based, no session auth.
  router.post('/payment/notification', async (c) => {
    const raw = await c.req.text();
    const headerSig = c.req.header('X-Callback-Signature') ?? c.req.header('X-Signature');
    const valid = await verifySignature(raw, headerSig, c.env.PAYMENT_WEBHOOK_SECRET);
    if (!valid) throw new UnauthorizedError('Invalid webhook signature');

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new UnauthorizedError('Invalid JSON payload');
    }

    const orderId = String(payload.orderId ?? payload.bookingNumber ?? '');
    const status = String(payload.transactionStatus ?? payload.status ?? '').toLowerCase();
    const transactionId = String(payload.transactionId ?? payload.transaction_id ?? '');
    const grossAmount = Number(payload.grossAmount ?? payload.amount ?? 0);

    if (!orderId) throw new UnauthorizedError('Missing orderId');

    const db = createDb(c.env.DB);
    const bookingRows = await db.select().from(bookings).where(eq(bookings.bookingNumber, orderId)).limit(1);
    if (!bookingRows[0]) throw new NotFoundError('Booking');
    const booking = bookingRows[0];

    const now = new Date().toISOString();

    if (PAID_STATUSES.includes(status)) {
      // NOTE: D1 does not support db.transaction() — sequential operations instead.
      const existing = await db
        .select({ id: payments.id })
        .from(payments)
        .where(and(eq(payments.bookingId, booking.id), eq(payments.transactionId, transactionId || orderId)))
        .limit(1);
      if (!existing[0]) {
        await db.insert(payments).values({
          id: crypto.randomUUID(),
          bookingId: booking.id,
          amount: grossAmount || booking.totalAmount,
          currency: 'IDR',
          method: String(payload.paymentType ?? payload.payment_type ?? ''),
          status: 'verified',
          gateway: String(payload.gateway ?? 'webhook'),
          transactionId: transactionId || null,
          verifiedBy: 'system',
          verifiedAt: now,
        });
      }
      const bookingPatch: Record<string, unknown> = { paymentStatus: 'paid', updatedAt: now };
      // Auto-hold deposit when payment is confirmed and deposit amount exists.
      if ((booking.depositAmount ?? 0) > 0 && booking.depositStatus === 'none') {
        bookingPatch.depositStatus = 'held';
      }
      await db.update(bookings).set(bookingPatch).where(eq(bookings.id, booking.id));
      if (booking.status === 'Pending' || booking.status === 'pending_payment') {
        await db.update(bookings).set({ status: 'Confirmed', updatedAt: now }).where(eq(bookings.id, booking.id));
      }
      return c.json({ success: true, message: 'Payment settled' });
    }

    if (FAILED_STATUSES.includes(status)) {
      const newStatus = status === 'expire' ? 'expired' : 'Cancelled';
      await db.update(bookings).set({ status: newStatus, paymentStatus: 'failed', updatedAt: now }).where(eq(bookings.id, booking.id));
      return c.json({ success: true, message: `Booking ${newStatus}` });
    }

    return c.json({ success: true, message: 'Notification received' });
  });

  return router;
}
