// Admin sessions. Admins sign in with Google on the separate admin sign-in page; if their email is in the
// admins table, the server hands out this short-lived admin session. It is separate from the participant
// sign-in: admin requests carry only this token, never a participant's Google token.
// The token is signed with a key derived from MATCH_KEY and names the admin's email.
import type { Identity } from './types';
import { b64u, unb64, unb64u } from './base64';

const enc = new TextEncoder();
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

export const identityKey = (id: Identity) => `google:${id.email}`;

async function sessionKey(matchKey: string): Promise<CryptoKey> {
  if (!matchKey) throw new Error('MATCH_KEY is not configured');
  const base = await crypto.subtle.importKey('raw', unb64(matchKey), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    // v2: admin sessions from Google sign-in (v1 sessions from the old admin password no longer work).
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode('admin-session-v2') },
    base,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign', 'verify'],
  );
}

/** A signed admin session for this email, valid for 2 hours. */
export async function signAdminSession(matchKey: string, email: string, nowMs = Date.now()) {
  const exp = nowMs + SESSION_TTL_MS;
  const body = b64u(enc.encode(JSON.stringify({ sub: email.toLowerCase(), kind: 'admin', exp })));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await sessionKey(matchKey), enc.encode(body)));
  return { token: `${body}.${b64u(sig)}`, email: email.toLowerCase(), expiresAt: new Date(exp).toISOString() };
}

/**
 * The admin's email for an untampered, unexpired admin session, else null.
 * (The caller still checks that this email is on the admin list, so removing an admin takes effect at once.)
 */
export async function verifyAdminSession(token: string | undefined, matchKey: string, nowMs = Date.now()): Promise<string | null> {
  if (!token) return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await sessionKey(matchKey), unb64u(sig), enc.encode(body));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(unb64u(body))) as { sub?: string; kind?: string; exp?: number };
    return p.kind === 'admin' && typeof p.sub === 'string' && p.sub && typeof p.exp === 'number' && p.exp > nowMs
      ? p.sub
      : null;
  } catch {
    return null;
  }
}
