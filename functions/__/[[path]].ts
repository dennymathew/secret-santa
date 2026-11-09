// Reverse proxy for Firebase Auth helper pages (/__/auth/*, /__/firebase/*).
// With VITE_FIREBASE_AUTH_DOMAIN set to the site's own domain, Google redirect sign-in
// stays first-party, so it keeps working in Safari and in-app browsers that block third-party storage.
import type { Env } from '../lib/types';

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const target = new URL(url.pathname + url.search, `https://${env.FIREBASE_PROJECT_ID}.firebaseapp.com`);
  return fetch(new Request(target.toString(), request));
};
