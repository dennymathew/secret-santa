// Admin panel password + short-lived admin sessions.
// The password itself is never stored: only a PBKDF2 hash (secret ADMIN_PASSWORD_HASH).
// A session token is signed with a key derived from MATCH_KEY, bound to the signed-in person,
// and becomes invalid as soon as the password changes.
import type { Identity } from './types';

const enc = new TextEncoder();
const ITERATIONS = 100_000; // the maximum Cloudflare Workers allows
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

const b64u = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const identityKey = (id: Identity) => (id.kind === 'phone' ? `phone:${id.phone}` : `google:${id.email}`);

function sameBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

/** "pbkdf2$<iterations>$<salt b64url>$<hash b64url>" (the same format scripts/set-admin-password.sh writes). */
export async function hashPassword(password: string, iterations = ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${iterations}$${b64u(salt)}$${b64u(await pbkdf2(password, salt, iterations))}`;
}

export async function verifyPassword(password: string, stored: string | undefined): Promise<boolean> {
  const parts = (stored ?? '').trim().split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2' || !password) return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 10_000 || iterations > ITERATIONS) return false;
  try {
    return sameBytes(await pbkdf2(password, unb64u(parts[2]), iterations), unb64u(parts[3]));
  } catch {
    return false;
  }
}

/** Short id of the current password hash: changing the password invalidates every session. */
const fingerprint = (stored: string) => (stored.trim().split('$')[3] ?? '').slice(0, 8);

async function sessionKey(matchKey: string): Promise<CryptoKey> {
  if (!matchKey) throw new Error('MATCH_KEY is not configured');
  const base = await crypto.subtle.importKey('raw', unb64(matchKey), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode('admin-session-v1') },
    base,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign', 'verify'],
  );
}

export async function signSession(matchKey: string, stored: string, sub: string, nowMs = Date.now()) {
  const exp = nowMs + SESSION_TTL_MS;
  const body = b64u(enc.encode(JSON.stringify({ sub, fp: fingerprint(stored), exp })));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await sessionKey(matchKey), enc.encode(body)));
  return { token: `${body}.${b64u(sig)}`, expiresAt: new Date(exp).toISOString() };
}

/** True only for an untampered, unexpired token for this exact person and the current password. */
export async function verifySession(
  token: string | undefined,
  matchKey: string,
  stored: string | undefined,
  sub: string,
  nowMs = Date.now(),
): Promise<boolean> {
  if (!token || !stored) return false;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return false;
  try {
    const ok = await crypto.subtle.verify('HMAC', await sessionKey(matchKey), unb64u(sig), enc.encode(body));
    if (!ok) return false;
    const p = JSON.parse(new TextDecoder().decode(unb64u(body))) as { sub?: string; fp?: string; exp?: number };
    return p.sub === sub && p.fp === fingerprint(stored) && typeof p.exp === 'number' && p.exp > nowMs;
  } catch {
    return false;
  }
}
