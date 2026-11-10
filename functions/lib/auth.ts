import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Env, Identity } from './types';

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),
);

const isLocalHost = (host: string) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);

/** The branch Cloudflare Pages deploys as production. Test mode can never be active there. */
export const PRODUCTION_BRANCH = 'main';

type ModeEnv = Pick<Env, 'DEV_AUTH' | 'TEST_MODE' | 'CF_PAGES_BRANCH'>;

/** The test site: TEST_MODE=1 on a Pages preview deployment (any branch except production). */
export const isTestMode = (env: ModeEnv) =>
  env.TEST_MODE === '1' && !!env.CF_PAGES_BRANCH && env.CF_PAGES_BRANCH !== PRODUCTION_BRANCH;

/**
 * Fake sign-in (a typed-in Google name and email, no real Google) is allowed only in local development
 * (DEV_AUTH=1 AND a localhost host) or on the test site.
 */
export const fakeAuthAllowed = (env: ModeEnv, host: string) =>
  (env.DEV_AUTH === '1' && isLocalHost(host)) || isTestMode(env);

/** Checks a Firebase ID token (Google sign-in only; or a fake token locally / on the test site). */
export async function verifyIdentity(token: string, env: Env, host: string): Promise<Identity | null> {
  if (!token) return null;

  // Fake sign-in: local development or the test site only (see fakeAuthAllowed).
  if (fakeAuthAllowed(env, host)) {
    if (token.startsWith('dev-google:')) {
      const [email, name] = token.slice('dev-google:'.length).split('|');
      return email ? { kind: 'google', email: email.toLowerCase(), name: name ?? '' } : null;
    }
  }

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
      audience: env.FIREBASE_PROJECT_ID,
    });
    const provider = (payload.firebase as { sign_in_provider?: string } | undefined)?.sign_in_provider;
    if (provider === 'google.com' && typeof payload.email === 'string' && payload.email_verified === true) {
      return { kind: 'google', email: payload.email.toLowerCase(), name: String(payload.name ?? '') };
    }
    return null;
  } catch {
    return null;
  }
}
