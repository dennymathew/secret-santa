import { logo, render, on, go } from '../ui';
import { isSignedIn } from '../auth';

export async function welcomeView() {
  const signedIn = await isSignedIn();
  render(`
    ${logo('Secret Santa for the Berlin Mallus')}
    <section class="card festive center">
      <span class="big-emoji wiggle" aria-hidden="true">🎅</span>
      <h2>Ho ho ho! Happy Christmas, chunks! 🎄</h2>
      <p>Santa needs a little help this year. Somebody in our gang is waiting for a gift from <b>you</b>.</p>
      <p class="muted">Verify your mobile number, open your envelope, and keep it a secret! 🤫</p>
    </section>
    <div class="stack">
      <button class="btn" id="go">${signedIn ? 'Continue 🎁' : 'Find my Secret Santa 🎅'}</button>
    </div>
    <p class="center" style="color:#dfe8ff;font-size:.9em;margin:0">❄️ Snow, cake and a little bit of chaos ❄️</p>
  `);
  on('#go', 'click', () => go(signedIn ? '#/home' : '#/verify'));
}
