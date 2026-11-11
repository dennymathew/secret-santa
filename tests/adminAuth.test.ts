import { describe, it, expect } from 'vitest';
import { signAdminSession, verifyAdminSession, SESSION_TTL_MS } from '../functions/lib/adminAuth';
import { fakeAuthAllowed, isTestMode } from '../functions/lib/auth';

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const OTHER_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));

describe('admin session', () => {
  it('names the admin email, lower-cased', async () => {
    const { token, email } = await signAdminSession(KEY, 'Me@Gmail.com');
    expect(email).toBe('me@gmail.com');
    expect(await verifyAdminSession(token, KEY)).toBe('me@gmail.com');
  });
  it('expires after 2 hours', async () => {
    const t0 = Date.now();
    const { token } = await signAdminSession(KEY, 'me@gmail.com', t0);
    expect(SESSION_TTL_MS).toBe(2 * 60 * 60 * 1000);
    expect(await verifyAdminSession(token, KEY, t0 + SESSION_TTL_MS - 1000)).toBe('me@gmail.com');
    expect(await verifyAdminSession(token, KEY, t0 + SESSION_TTL_MS + 1)).toBeNull();
  });
  it('is useless with another key (a different MATCH_KEY)', async () => {
    const { token } = await signAdminSession(KEY, 'me@gmail.com');
    expect(await verifyAdminSession(token, OTHER_KEY)).toBeNull();
  });
  it('rejects missing, broken and forged tokens', async () => {
    const { token } = await signAdminSession(KEY, 'me@gmail.com');
    const [body, sig] = token.split('.');
    const forgedBody = btoa(JSON.stringify({ sub: 'evil@gmail.com', kind: 'admin', exp: Date.now() + 1e9 })).replace(/=+$/, '');
    for (const bad of [undefined, '', 'abc', `${body}.`, `.${sig}`, `${forgedBody}.${sig}`, `${body}.${sig}.x`, `${body}.${sig.slice(0, -2)}AA`])
      expect(await verifyAdminSession(bad, KEY)).toBeNull();
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
