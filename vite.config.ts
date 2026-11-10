import { defineConfig } from 'vite';

// Public Firebase web config (Firebase → Project settings → Your apps). These values are not secrets:
// every Firebase web app ships them to the browser. Access is limited by Firebase itself
// (authorized domains, SMS region policy), not by hiding them.
const FIREBASE = {
  apiKey: 'AIzaSyAOnmNEp0rDgbCuZDPlt-zqSV8njJuDIe0',
  projectId: 'secretsantaberlinmallus',
  appId: '1:292472980463:web:d6c8e2e1a4b0c90b4b2c1a',
  // The site's own domain, so Google sign-in goes through the /__/auth proxy (works in Safari and in-app browsers).
  authDomain: 'berlinmallusanta.pages.dev',
};

// Firebase is built in ONLY for the real site: Cloudflare Pages building the production branch.
// Test-site builds (any other branch) and local builds get no Firebase config at all,
// so they use the fake sign-in (code 123456) and can never send an SMS.
const PRODUCTION_BRANCH = 'main';
// (process.env without node types: this file also gets type-checked with the browser code)
const buildEnv: Record<string, string | undefined> = (globalThis as any).process?.env ?? {};
const useFirebase = buildEnv.CF_PAGES_BRANCH === PRODUCTION_BRANCH;

export default defineConfig({
  // During `npm run dev`, API calls go to `wrangler pages dev` on port 8788.
  server: {
    proxy: { '/api': 'http://127.0.0.1:8788' },
  },
  build: { target: 'es2020' },
  define: {
    'import.meta.env.VITE_FIREBASE_API_KEY': JSON.stringify(useFirebase ? FIREBASE.apiKey : ''),
    'import.meta.env.VITE_FIREBASE_PROJECT_ID': JSON.stringify(useFirebase ? FIREBASE.projectId : ''),
    'import.meta.env.VITE_FIREBASE_APP_ID': JSON.stringify(useFirebase ? FIREBASE.appId : ''),
    'import.meta.env.VITE_FIREBASE_AUTH_DOMAIN': JSON.stringify(useFirebase ? FIREBASE.authDomain : ''),
  },
});
