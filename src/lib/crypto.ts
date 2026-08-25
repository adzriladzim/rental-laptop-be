// Password hashing + timing-safe comparison using Web Crypto API (PBKDF2-SHA256).
// Format: base64(salt[16] || derivedKey[32]).

const PBKDF2_ITERATIONS = 100_000;

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  const derived = new Uint8Array(derivedBits);
  const combined = new Uint8Array(16 + 32);
  combined.set(salt, 0);
  combined.set(derived, 16);
  return toBase64(combined);
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const combined = fromBase64(stored);
    const salt = combined.slice(0, 16);
    const key = combined.slice(16);
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits'],
    );
    const derivedBits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      keyMaterial,
      256,
    );
    const derived = new Uint8Array(derivedBits);
    if (derived.length !== key.length) return false;
    let result = 0;
    for (let i = 0; i < derived.length; i++) result |= derived[i] ^ key[i];
    return result === 0;
  } catch {
    return false;
  }
}

export function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let result = 0;
  for (let i = 0; i < ea.length; i++) result |= ea[i] ^ eb[i];
  return result === 0;
}

export async function sha256Hex(input: string): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
