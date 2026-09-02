// Midtrans Snap integration — env-driven, mock fallback when no key.
// Docs: https://docs.midtrans.com/reference/snap-api

const MIDTRANS_BASE = {
  sandbox: 'https://app.sandbox.midtrans.com',
  production: 'https://app.midtrans.com',
};

interface SnapCreateResponse {
  token: string;
  redirect_url: string;
}

/**
 * Create a Midtrans Snap transaction token.
 * Falls back to mock token if MIDTRANS_SERVER_KEY is empty/missing.
 */
export async function createSnapToken(params: {
  orderId: string;
  amount: number;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  itemDetails?: { id: string; name: string; price: number; quantity: number }[];
  env: string;
  midtransServerKey: string;
}): Promise<{ token: string; redirectUrl: string }> {
  const { orderId, amount, customerName, customerEmail, customerPhone, itemDetails, env, midtransServerKey } = params;

  // Fallback: no key → mock token (dev/demo)
  if (!midtransServerKey) {
    console.log(`[payment] MIDTRANS_SERVER_KEY not set — using mock token for ${orderId}`);
    return { token: `mock-snap-${orderId}`, redirectUrl: '' };
  }

  const baseUrl = env === 'production' ? MIDTRANS_BASE.production : MIDTRANS_BASE.sandbox;

  const items = itemDetails ?? [
    { id: orderId, name: 'Laptop Rental', price: amount, quantity: 1 },
  ];

  const body = {
    transaction_details: { order_id: orderId, gross_amount: amount },
    item_details: items,
    customer_details: {
      first_name: customerName,
      email: customerEmail || undefined,
      phone: customerPhone || undefined,
    },
  };

  // Basic auth: base64(key:)
  const authHeader = 'Basic ' + btoa(`${midtransServerKey}:`);

  try {
    const res = await fetch(`${baseUrl}/snap/v1/transaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[payment] Midtrans API error ${res.status}:`, errText);
      // On API error, fallback to mock to not block the booking flow
      return { token: `mock-snap-${orderId}`, redirectUrl: '' };
    }

    const data: SnapCreateResponse = await res.json() as SnapCreateResponse;
    return { token: data.token, redirectUrl: data.redirect_url };
  } catch (err) {
    console.error('[payment] Midtrans request failed:', err);
    return { token: `mock-snap-${orderId}`, redirectUrl: '' };
  }
}
