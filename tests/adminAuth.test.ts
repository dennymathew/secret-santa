import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, signSession, verifySession, SESSION_TTL_MS, personalAdminHashes, adminHashFor } from '../functions/lib/adminAuth';
import { fakeAuthAllowed, isTestMode } from '../functions/lib/auth';

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const OTHER_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
const ME = 'google:me@gmail.com';

describe('admin password', () => {
  it('accepts the right password and rejects anything else', async () => {
    const h = await hashPassword('correct horse battery', 20_000);
    expect(h).toMatch(/^pbkdf2\$20000\$/);
    expect(await verifyPassword('correct horse battery', h)).toBe(true);
    expect(await verifyPassword('correct horse batterY', h)).toBe(false);
    expect(await verifyPassword('', h)).toBe(false);
  });

  it('fails closed when no password is set up or the hash is malformed', async () => {
    expect(await verifyPassword('anything', undefined)).toBe(false);
    expect(await verifyPassword('anything', '')).toBe(false);
    expect(await verifyPassword('anything', 'plain-text-password')).toBe(false);
    expect(await verifyPassword('anything', 'pbkdf2$1$abc$def')).toBe(false); // too few iterations
  });

  it('reads the hash format written by scripts/set-admin-password.sh (node crypto)', async () => {
    // @ts-ignore -- node types aren't installed (the app code runs on Workers); vitest runs in node
    const { pbkdf2Sync, randomBytes } = await import('node:crypto');
    const salt = randomBytes(16);
    const h = `pbkdf2$100000$${salt.toString('base64url')}$${pbkdf2Sync('from the script', salt, 100000, 32, 'sha256').toString('base64url')}`;
    expect(await verifyPassword('from the script', h)).toBe(true);
    expect(await verifyPassword('from the scrip', h)).toBe(false);
  });
});

describe('admin session', () => {
  it('is valid only for the same person, before it expires, with the current password', async () => {
    const h = await hashPassword('pw-one-1234', 20_000);
    const t0 = Date.now();
    const { token } = await signSession(KEY, h, ME, t0);
    expect(await verifySession(token, KEY, h, ME, t0 + 1000)).toBe(true);
    // expired
    expect(await verifySession(token, KEY, h, ME, t0 + SESSION_TTL_MS + 1)).toBe(false);
    // somebody else signed in, using a copied token
    expect(await verifySession(token, KEY, h, 'google:someone.else@gmail.com', t0)).toBe(false);
    // password changed since
    const h2 = await hashPassword('pw-two-5678', 20_000);
    expect(await verifySession(token, KEY, h2, ME, t0)).toBe(false);
    // signed with a different key (e.g. forged)
    expect(await verifySession(token, OTHER_KEY, h, ME, t0)).toBe(false);
    // no password configured
    expect(await verifySession(token, KEY, undefined, ME, t0)).toBe(false);
  });

  it('rejects tampered or garbage tokens', async () => {
    const h = await hashPassword('pw-one-1234', 20_000);
    const { token } = await signSession(KEY, h, ME);
    const [body, sig] = token.split('.');
    const forgedBody = btoa(JSON.stringify({ sub: ME, fp: 'x', exp: Date.now() + 1e9 })).replace(/=+$/, '');
    for (const bad of [undefined, '', 'abc', `${body}.`, `.${sig}`, `${forgedBody}.${sig}`, `${body}.${sig}.x`, `${body}.${sig.slice(0, -2)}AA`])
      expect(await verifySession(bad, KEY, h, ME)).toBe(false);
  });
});

describe('test mode gate', () => {
  it('allows fake sign-in only locally (DEV_AUTH) or on a non-production branch with TEST_MODE', () => {
    expect(fakeAuthAllowed({ DEV_AUTH: '1' }, 'localhost:8788')).toBe(true);
    expect(fakeAuthAllowed({ DEV_AUTH: '1' }, 'berlinmallusanta.pages.dev')).toBe(false);
    expect(fakeAuthAllowed({ TEST_MODE: '1', CF_PAGES_BRANCH: 'test' }, 'test.berlinmallusanta.pages.dev')).toBe(true);
    // production branch: never, even if TEST_MODE were set there by mistake
    expect(fakeAuthAllowed({ TEST_MODE: '1', CF_PAGES_BRANCH: 'main' }, 'berlinmallusanta.pages.dev')).toBe(false);
    expect(fakeAuthAllowed({ TEST_MODE: '1' }, 'berlinmallusanta.pages.dev')).toBe(false);
    expect(fakeAuthAllowed({ CF_PAGES_BRANCH: 'test' }, 'test.berlinmallusanta.pages.dev')).toBe(false);
    expect(isTestMode({ TEST_MODE: '1', CF_PAGES_BRANCH: 'main' })).toBe(false);
    expect(isTestMode({ TEST_MODE: '1', CF_PAGES_BRANCH: 'test' })).toBe(true);
  });
});

describe('personal admin passwords', () => {
  const env = {
    ADMIN_PASSWORD_HASH: 'shared-hash',
    ADMIN_PW_DENNY_GMAIL_COM: 'Denny@Gmail.com|denny-hash',
    ADMIN_PW_ANU_GMAIL_COM: ' anu@gmail.com | anu-hash ',
    ADMIN_PW_BROKEN: 'no-bar-here',
    ADMIN_EMAILS: 'x@y.com',
  };
  it('reads one email and hash from each ADMIN_PW_* secret, ignoring malformed ones', () => {
    expect([...personalAdminHashes(env)]).toEqual([
      ['denny@gmail.com', 'denny-hash'],
      ['anu@gmail.com', 'anu-hash'],
    ]);
  });
  it('gives each admin their own password, and everyone else the shared one', () => {
    expect(adminHashFor(env, 'DENNY@gmail.com')).toBe('denny-hash');
    expect(adminHashFor(env, 'anu@gmail.com')).toBe('anu-hash');
    expect(adminHashFor(env, 'someone@gmail.com')).toBe('shared-hash');
  });
  it('without a shared password, only the named admins have one', () => {
    const { ADMIN_PASSWORD_HASH: _, ...noShared } = env;
    expect(adminHashFor(noShared, 'someone@gmail.com')).toBeUndefined();
    expect(adminHashFor(noShared, 'anu@gmail.com')).toBe('anu-hash');
  });
  it("one admin's session doesn't work with another admin's password", async () => {
    const denny = await hashPassword('denny-password-1', 10_000);
    const anu = await hashPassword('anu-password-12', 10_000);
    const { token } = await signSession(KEY, denny, 'google:denny@gmail.com');
    expect(await verifySession(token, KEY, denny, 'google:denny@gmail.com')).toBe(true);
    expect(await verifySession(token, KEY, anu, 'google:denny@gmail.com')).toBe(false);
  });
});
