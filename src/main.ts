import './styles.css';
import { startSnow, buildLights } from './effects/snow';
import { initAuth, isSignedIn, signOut, TEST_SITE, isAdminSignedIn, takeAfterGoogle, finishAdminSignIn } from './auth';
import { ApiError } from './api';
import { render, logo, esc, redirect, spinner, on, go, footer } from './ui';
import { welcomeView } from './views/welcome';
import { verifyView } from './views/verify';
import { claimView } from './views/claim';
import { homeView } from './views/home';
import { revealView } from './views/reveal';
import { boardView } from './views/board';
import { adminView } from './views/admin';
import { adminLoginView } from './views/adminLogin';

startSnow(document.getElementById('snow') as HTMLCanvasElement);
buildLights(document.querySelector('.lights') as HTMLElement);

// Participant pages need the participant (Google) sign-in; admin pages need an admin session.
// The two sides are separate: with an admin session, only admin pages open (sign out to use the other side).
const routes: Record<string, { view: () => Promise<void>; auth: 'none' | 'participant' | 'admin' }> = {
  '': { view: welcomeView, auth: 'none' },
  verify: { view: verifyView, auth: 'none' },
  claim: { view: claimView, auth: 'participant' },
  home: { view: homeView, auth: 'participant' },
  reveal: { view: revealView, auth: 'participant' },
  board: { view: boardView, auth: 'participant' },
  'admin-login': { view: adminLoginView, auth: 'none' },
  admin: { view: adminView, auth: 'admin' },
};
const ADMIN_PAGES = new Set(['admin', 'admin-login']);
const BASE_TITLE = document.title;

async function route() {
  const name = location.hash.replace(/^#\/?/, '').split('?')[0];
  const r = routes[name] ?? routes[''];
  const adminSide = ADMIN_PAGES.has(name);
  // Admin pages carry a blue admin bar and "Admin" in the tab title, so the two sides are easy to tell apart.
  document.title = `${TEST_SITE ? '🧪 TEST · ' : ''}${adminSide ? '🛠 Admin · ' : ''}${BASE_TITLE}`;
  try {
    if (isAdminSignedIn()) {
      if (!adminSide || name === 'admin-login') return redirect('#/admin');
    } else {
      if (r.auth === 'admin') return redirect('#/admin-login');
      if (r.auth === 'participant' && !(await isSignedIn())) return redirect('#/verify');
      if (name === 'verify' && (await isSignedIn())) return redirect('#/home');
    }
    await r.view();
  } catch (e) {
    if (e instanceof ApiError && e.adminLocked) return redirect('#/admin-login');
    if (e instanceof ApiError && e.status === 401) {
      await signOut();
      return redirect('#/verify');
    }
    const signedIn = await isSignedIn().catch(() => false);
    if (e instanceof ApiError && e.closed) {
      render(`${logo()}<section class="card festive center"><span class="big-emoji wiggle">🎄</span><h2>Merry Christmas!</h2><p>Secret Santa is over for this year. See you next December! ⛄</p><p class="muted">All accounts and data have been removed.</p></section>${signedIn ? footer() : ''}`);
      return;
    }
    render(`${logo()}<section class="card festive center"><span class="big-emoji">🙈</span><h2>Oops</h2><p class="error">${esc(e instanceof Error ? e.message : e)}</p><button class="btn" id="retry">Try again</button></section>${signedIn ? footer() : ''}`);
    on('#retry', 'click', () => route());
  }
}

(async () => {
  spinner();
  await initAuth().catch((e) => console.error(e));
  if (TEST_SITE) {
    document.body.insertAdjacentHTML('beforeend', '<div class="test-banner" role="status">🧪 TEST SITE · fake Google sign-in · not the real game</div>');
  }
  // Back from Google: the admin sign-in becomes an admin session; a participant sign-in goes home.
  // (replaceState, not location.hash: that would fire a second hashchange and draw the page twice,
  // losing a one-time message like "isn't an admin".)
  const after = takeAfterGoogle();
  if (after === 'admin') {
    await finishAdminSignIn();
    history.replaceState(null, '', isAdminSignedIn() ? '#/admin' : '#/admin-login');
  } else if (after === 'participant' && (await isSignedIn())) {
    if (!location.hash.startsWith('#/home')) history.replaceState(null, '', '#/home');
  }
  // Sign out link at the bottom of every signed-in page (see footer() in ui.ts).
  document.getElementById('app')!.addEventListener('click', async (e) => {
    if (!(e.target as HTMLElement).closest('[data-signout]')) return;
    e.preventDefault();
    const wasAdmin = isAdminSignedIn();
    await signOut();
    // An admin lands on the normal sign-in page, from where they can sign in as a participant.
    go(wasAdmin ? '#/verify' : '#/');
  });
  window.addEventListener('hashchange', route);
  route();
})();
