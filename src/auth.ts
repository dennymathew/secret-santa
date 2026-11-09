// Sign-in: Firebase phone OTP, with Google as the fallback.
// Without a Firebase config (local dev) a fake sign-in is used: OTP is always 123456.
import type { Auth, ConfirmationResult, RecaptchaVerifier } from 'firebase/auth';

const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
};
export const DEV_MODE = !cfg.apiKey;
const DEV_KEY = 'bms-dev-token';

let auth: Auth | null = null;
let fb: typeof import('firebase/auth') | null = null;
let verifier: RecaptchaVerifier | null = null;
let confirmation: ConfirmationResult | null = null;
let devPendingPhone: string | null = null;

export async function initAuth(): Promise<void> {
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
    // Session only: closing the tab signs you out, as with a fresh OTP each visit.
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

export async function sendCode(phoneE164: string, buttonId: string): Promise<void> {
  if (DEV_MODE) {
    devPendingPhone = phoneE164;
    return;
  }
  if (!auth || !fb) throw new Error('Sign-in is still loading, please try again.');
  verifier?.clear();
  verifier = new fb.RecaptchaVerifier(auth, buttonId, { size: 'invisible' });
  try {
    confirmation = await fb.signInWithPhoneNumber(auth, phoneE164, verifier);
  } catch (e) {
    verifier.clear();
    verifier = null;
    throw new Error(friendlyError(e));
  }
}

export async function confirmCode(code: string): Promise<void> {
  if (DEV_MODE) {
    if (code !== '123456') throw new Error("That code isn't right. (Dev mode: use 123456)");
    sessionStorage.setItem(DEV_KEY, `dev-phone:${devPendingPhone}`);
    return;
  }
  if (!confirmation) throw new Error('Please request a new code.');
  try {
    await confirmation.confirm(code);
  } catch (e) {
    throw new Error(friendlyError(e));
  }
}

export async function googleSignIn(): Promise<void> {
  if (DEV_MODE) {
    const name = prompt('DEV MODE: Google account name', 'Anu Mary Kurian');
    if (!name) return;
    const email = prompt('DEV MODE: Google email', `${name.split(' ')[0].toLowerCase()}@gmail.com`);
    if (!email) return;
    sessionStorage.setItem(DEV_KEY, `dev-google:${email}|${name}`);
    location.hash = '#/home';
    location.reload();
    return;
  }
  if (!auth || !fb) throw new Error('Sign-in is still loading, please try again.');
  const provider = new fb.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  // Redirect works better than popups inside WhatsApp's in-app browser.
  sessionStorage.setItem('bms-after-google', '1');
  await fb.signInWithRedirect(auth, provider);
}

export function takeGoogleError(): string | null {
  const e = sessionStorage.getItem('bms-google-error');
  sessionStorage.removeItem('bms-google-error');
  return e;
}

export async function signOut() {
  sessionStorage.removeItem(DEV_KEY);
  if (auth && fb) await fb.signOut(auth);
}

function friendlyError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  const map: Record<string, string> = {
    'auth/invalid-verification-code': "That code isn't right. Please check the SMS and try again.",
    'auth/code-expired': 'That code has expired. Please request a new one.',
    'auth/too-many-requests': 'Too many tries. Please wait a few minutes, or use Google sign-in below.',
    'auth/invalid-phone-number': "That phone number doesn't look right.",
    'auth/quota-exceeded': "We've hit today's SMS limit. Please use Google sign-in below.",
    'auth/captcha-check-failed': 'The robot check failed. Please reload the page and try again.',
    'auth/network-request-failed': 'Network problem. Check your connection and try again.',
    'auth/web-storage-unsupported': 'This browser blocks sign-in storage. Please open the link in Chrome or Safari.',
    'auth/operation-not-supported-in-this-environment': 'Please open the link in Chrome or Safari.',
    'auth/unauthorized-domain': 'This site is not yet authorised in Firebase (admin: add the domain).',
  };
  return map[code] ?? (e instanceof Error ? e.message : 'Something went wrong. Please try again.');
}
