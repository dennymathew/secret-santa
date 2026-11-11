// Sign-in: Google through Firebase (no phone numbers, no SMS).
// Without a Firebase config (local dev), or on the test site, a fake Google sign-in is used:
// you type a name and email, and the server treats them as a Google account.
import type { Auth } from 'firebase/auth';

const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
};
/** Fake Google sign-in. Decided in initAuth(): no Firebase config, or the server says it's the test site. */
export let DEV_MODE = !cfg.apiKey;
/** True on the deployed test site (separate database, no real Google). */
export let TEST_SITE = false;
const DEV_KEY = 'bms-dev-token';
export const ADMIN_KEY = 'bms-admin-session';
const ADMIN_EMAIL_KEY = 'bms-admin-email';
const ADMIN_ERROR = 'bms-admin-error';
const AFTER_GOOGLE = 'bms-after-google';

let auth: Auth | null = null;
let fb: typeof import('firebase/auth') | null = null;

export async function initAuth(): Promise<void> {
  // The server decides whether this is the test site (it never is on the production branch).
  const conf = await fetch('/api/config')
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  if ((conf as { testMode?: boolean }).testMode) {
    TEST_SITE = true;
    DEV_MODE = true;
  }
  if (DEV_MODE) return;
  const [{ initializeApp }, fbAuth] = await Promise.all([import('firebase/app'), import('firebase/auth')]);
  fb = fbAuth;
  const app = initializeApp({
    apiKey: cfg.apiKey,
    projectId: cfg.projectId,
    appId: cfg.appId,
    authDomain: cfg.authDomain || `${cfg.projectId}.firebaseapp.com`,
  });
  auth = fb.initializeAuth(app, {
    // Session only: closing the tab signs you out.
    persistence: [fb.browserSessionPersistence, fb.inMemoryPersistence],
    popupRedirectResolver: fb.browserPopupRedirectResolver,
  });
  auth.languageCode = 'en';
  try {
    await fb.getRedirectResult(auth); // finishes a Google redirect sign-in
  } catch (e) {
    sessionStorage.setItem('bms-google-error', friendlyError(e));
  }
  await auth.authStateReady();
}

export async function getToken(): Promise<string | null> {
  if (DEV_MODE) return sessionStorage.getItem(DEV_KEY);
  return (await auth?.currentUser?.getIdToken()) ?? null;
}

export async function isSignedIn() {
  return !!(await getToken());
}

/**
 * Google sign-in. `as: 'admin'` is the separate admin sign-in: after Google, the account is exchanged for an
 * admin session (see finishAdminSignIn) and the Google sign-in itself is dropped again.
 */
export async function googleSignIn(as: 'participant' | 'admin' = 'participant'): Promise<void> {
  sessionStorage.setItem(AFTER_GOOGLE, as);
  if (DEV_MODE) {
    const label = TEST_SITE ? 'TEST SITE' : 'DEV MODE';
    const name = prompt(`${label}: Google account name`, 'Firstname Lastname');
    if (!name) return;
    const email = prompt(`${label}: Google email`, 'name@gmail.com');
    if (!email) return;
    sessionStorage.setItem(DEV_KEY, `dev-google:${email}|${name}`);
    location.hash = as === 'admin' ? '#/admin' : '#/home';
    location.reload();
    return;
  }
  if (!auth || !fb) throw new Error('Sign-in is still loading, please try again.');
  const provider = new fb.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  // Redirect works better than popups inside WhatsApp's in-app browser.
  await fb.signInWithRedirect(auth, provider);
}

/** Which sign-in just came back from Google, if any ('participant' or 'admin'). Read once. */
export function takeAfterGoogle(): 'participant' | 'admin' | null {
  const v = sessionStorage.getItem(AFTER_GOOGLE);
  sessionStorage.removeItem(AFTER_GOOGLE);
  return v === 'admin' || v === 'participant' ? v : null;
}

/** Signed in to the admin panel (an admin session, not a participant sign-in). */
export const isAdminSignedIn = () => !!sessionStorage.getItem(ADMIN_KEY);
export const adminEmail = () => sessionStorage.getItem(ADMIN_EMAIL_KEY) ?? '';

/**
 * Turns the Google sign-in that just happened into an admin session, then drops the Google sign-in,
 * so this browser is signed in as admin only (never as a participant at the same time).
 */
export async function finishAdminSignIn(): Promise<void> {
  const token = await getToken();
  try {
    if (!token) throw new Error('Google sign-in was cancelled. Please try again.');
    const res = await fetch('/api/admin/login', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    const data = (await res.json().catch(() => ({}))) as { token?: string; email?: string; error?: string };
    if (!res.ok || !data.token) throw new Error(data.error ?? `Admin sign-in failed (${res.status}).`);
    sessionStorage.setItem(ADMIN_KEY, data.token);
    sessionStorage.setItem(ADMIN_EMAIL_KEY, data.email ?? '');
  } catch (e) {
    sessionStorage.setItem(ADMIN_ERROR, e instanceof Error ? e.message : String(e));
  } finally {
    await signOutGoogle();
  }
}

export function takeAdminError(): string | null {
  const e = sessionStorage.getItem(ADMIN_ERROR);
  sessionStorage.removeItem(ADMIN_ERROR);
  return e;
}

export function takeGoogleError(): string | null {
  const e = sessionStorage.getItem('bms-google-error');
  sessionStorage.removeItem('bms-google-error');
  return e;
}

async function signOutGoogle() {
  sessionStorage.removeItem(DEV_KEY);
  if (auth && fb) await fb.signOut(auth);
}

/** Signs out completely: the participant sign-in and the admin session. */
export async function signOut() {
  sessionStorage.removeItem(ADMIN_KEY);
  sessionStorage.removeItem(ADMIN_EMAIL_KEY);
  await signOutGoogle();
}

function friendlyError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  const map: Record<string, string> = {
    'auth/too-many-requests': 'Too many tries. Please wait a few minutes and try again.',
    'auth/popup-closed-by-user': 'Google sign-in was closed. Please try again.',
    'auth/user-cancelled': 'Google sign-in was cancelled. Please try again.',
    'auth/disallowed-useragent': "Google doesn't allow sign-in inside this app. Please open the link in Chrome or Safari.",
    'auth/network-request-failed': 'Network problem. Check your connection and try again.',
    'auth/web-storage-unsupported': 'This browser blocks sign-in storage. Please open the link in Chrome or Safari.',
    'auth/operation-not-supported-in-this-environment': 'Please open the link in Chrome or Safari.',
    'auth/unauthorized-domain': 'This site is not yet authorised in Firebase (admin: add the domain).',
  };
  return map[code] ?? (e instanceof Error ? e.message : 'Something went wrong. Please try again.');
}
