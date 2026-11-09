import './styles.css';
import { startSnow, buildLights } from './effects/snow';
import { initAuth, isSignedIn, signOut } from './auth';
import { ApiError } from './api';
import { render, logo, esc, go, spinner, on } from './ui';
import { welcomeView } from './views/welcome';
import { verifyView } from './views/verify';
import { claimView } from './views/claim';
import { homeView } from './views/home';
import { revealView } from './views/reveal';
import { boardView } from './views/board';
import { adminView } from './views/admin';

startSnow(document.getElementById('snow') as HTMLCanvasElement);
buildLights(document.querySelector('.lights') as HTMLElement);

const routes: Record<string, { view: () => Promise<void>; auth: boolean }> = {
  '': { view: welcomeView, auth: false },
  verify: { view: verifyView, auth: false },
  claim: { view: claimView, auth: true },
  home: { view: homeView, auth: true },
  reveal: { view: revealView, auth: true },
  board: { view: boardView, auth: true },
  admin: { view: adminView, auth: true },
};

async function route() {
  const name = location.hash.replace(/^#\/?/, '').split('?')[0];
  const r = routes[name] ?? routes[''];
  try {
    if (r.auth && !(await isSignedIn())) return go('#/verify');
    if (name === 'verify' && (await isSignedIn())) return go('#/home');
    await r.view();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      await signOut();
      return go('#/verify');
    }
    if (e instanceof ApiError && e.closed) {
      render(`${logo()}<section class="card festive center"><span class="big-emoji wiggle">🎄</span><h2>Merry Christmas!</h2><p>Secret Santa is over for this year. See you next December! ⛄</p></section>`);
      return;
    }
    render(`${logo()}<section class="card festive center"><span class="big-emoji">🙈</span><h2>Oops</h2><p class="error">${esc(e instanceof Error ? e.message : e)}</p><button class="btn" id="retry">Try again</button></section>`);
    on('#retry', 'click', () => route());
  }
}

(async () => {
  spinner();
  await initAuth().catch((e) => console.error(e));
  if (sessionStorage.getItem('bms-after-google') && (await isSignedIn())) {
    sessionStorage.removeItem('bms-after-google');
    if (!location.hash.startsWith('#/home')) location.hash = '#/home';
  }
  window.addEventListener('hashchange', route);
  route();
})();
