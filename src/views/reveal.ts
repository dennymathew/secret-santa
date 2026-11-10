import { logo, render, esc, go, on, fmtTime, $, spinner, footer } from '../ui';
import { api, type Me } from '../api';
import { drumRoll } from '../effects/drumroll';
import { confetti } from '../effects/confetti';
import { signOut } from '../auth';

const GIFT_SVG = `<svg class="gift" viewBox="0 0 200 200" aria-hidden="true">
  <g class="box">
    <rect x="30" y="90" width="140" height="100" rx="10" fill="#c8102e"/>
    <rect x="88" y="90" width="24" height="100" fill="#f6c344"/>
    <rect x="30" y="90" width="140" height="14" fill="rgba(0,0,0,.12)"/>
    <circle cx="60" cy="140" r="6" fill="#fff" opacity=".5"/><circle cx="140" cy="160" r="5" fill="#fff" opacity=".5"/>
    <circle cx="150" cy="120" r="4" fill="#fff" opacity=".5"/><circle cx="55" cy="175" r="4" fill="#fff" opacity=".5"/>
  </g>
  <g class="lid">
    <rect x="20" y="66" width="160" height="30" rx="8" fill="#e3203f"/>
    <rect x="88" y="66" width="24" height="30" fill="#f6c344"/>
    <path d="M100 66 C70 20 40 40 60 66Z" fill="#f6c344"/><path d="M100 66 C130 20 160 40 140 66Z" fill="#f6c344"/>
    <circle cx="100" cy="64" r="9" fill="#e0a92a"/>
  </g>
</svg>`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type RevealResult = { for: string; isKid: boolean; receiver: string; firstOpenedAt: string; firstTime: boolean };

export async function revealView() {
  const kidId = Number(new URLSearchParams(location.hash.split('?')[1] ?? '').get('kid')) || undefined;
  if (kidId) return kidFlow(kidId);

  // Already opened (e.g. the back button, or a reload): show it straight away, no drum roll again.
  spinner();
  const me = await api<Me>('/me');
  if (me.participant?.revealedAt) return showSecretSanta(await api<RevealResult>('/reveal', { body: {} }));

  const result = api<RevealResult>('/reveal', { body: {} });
  result.catch(() => {}); // handled below
  const gift = await drumRollStage('Your Secret Santa is…');
  let r: RevealResult;
  try {
    r = await result;
  } catch (e) {
    return oops(e);
  }
  await openGift(gift);
  showSecretSanta(r);
}

/**
 * A parent hands the phone to a kid. The phone signs out of the parent's account as soon as the kid's
 * Secret Santa arrives, so the kid can't go back and peek at the parent's (or a sibling's).
 */
async function kidFlow(kidId: number) {
  spinner();
  const me = await api<Me>('/me');
  const kid = me.kids.find((k) => k.id === kidId);
  if (!kid) return oops(new Error('You can only open envelopes for kids in your own family.'));
  const name = esc(kid.name);

  // 1) Warn the parent first.
  render(`
    ${logo()}
    <section class="card festive center">
      <span class="big-emoji">🔒</span>
      <h2>You'll be signed out now</h2>
      <p>When ${name}'s envelope opens, this phone signs out of your account, so ${name} can't peek at your Secret Santa.</p>
      <p class="muted">To see your own envelope again afterwards, please sign in again.</p>
    </section>
    <div class="stack">
      <button class="btn green" id="handover">OK, hand the phone to ${name} 🧒</button>
      <button class="btn ghost light" id="cancel">Cancel</button>
    </div>
    ${footer()}
  `);
  on('#cancel', 'click', () => go('#/home'));
  on('#handover', 'click', () => {
    // 2) The kid's screen.
    render(`
      ${logo()}
      <section class="card festive center">
        <span class="big-emoji wiggle">🎅</span>
        <h2>Hi ${name}!</h2>
        <p>Santa has an envelope for you. Only you should look 👀</p>
      </section>
      <div class="stack"><button class="btn" id="open">I'm ${name}, open it 🎁</button></div>
      ${footer()}
    `);
    on('#open', 'click', async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      btn.disabled = true;
      let r: RevealResult;
      try {
        r = await api<RevealResult>('/reveal', { body: { kidId } });
      } catch (err) {
        return oops(err);
      }
      // 3) Sign out before anything is shown: from now on Back or reload only reach the sign-in page.
      await signOut();
      if (r.firstTime) await openGift(await drumRollStage('Drum roll for the little Santa… 🧒'));
      showKidSecretSanta(r);
    });
  });
}

/** Drum roll and countdown on a shaking gift. Returns the gift, ready to open. */
async function drumRollStage(label: string): Promise<HTMLElement> {
  render(`
    <div class="reveal-stage">
      <p style="margin:0;font-size:1.1em">${label}</p>
      ${GIFT_SVG}
      <div class="drum" aria-hidden="true">🥁</div>
      <div class="countdown" id="count"></div>
    </div>
  `);
  const gift = $('.gift');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  drumRoll(reduced ? 0.5 : 4.2);
  gift.classList.add('shake');
  if (!reduced) {
    await sleep(1200);
    for (const n of ['3', '2', '1']) {
      $('#count').textContent = n;
      if (n === '2') gift.classList.add('faster');
      await sleep(1000);
    }
  } else await sleep(500);
  return gift;
}

async function openGift(gift: HTMLElement) {
  $('#count').textContent = '';
  gift.classList.add('open');
  confetti();
  await sleep(500);
}

function oops(e: unknown) {
  render(`${logo()}<section class="card festive center"><span class="big-emoji">🙈</span><h2>Oops</h2><p class="error">${esc(e instanceof Error ? e.message : e)}</p></section><button class="btn" id="back">Back</button>`);
  on('#back', 'click', () => go('#/home'));
}

const resultCard = (r: RevealResult) => `
  <section class="card festive center match-card">
    <span class="big-emoji">🎉</span>
    <p class="muted" style="margin-top:8px">${r.isKid ? `${esc(r.for)} is Secret Santa for…` : 'You are Secret Santa for…'}</p>
    <p class="match-name">✨ ${esc(r.receiver)} ✨</p>
    <p>Shhh… keep it secret! 🤫 Start thinking about the perfect gift 🎁</p>
    <p class="muted">${r.firstTime ? 'Opened just now.' : `First opened on ${esc(fmtTime(r.firstOpenedAt))}.`}</p>
  </section>`;

function showSecretSanta(r: RevealResult) {
  render(`
    <div class="reveal-stage">
      ${resultCard(r)}
      <div class="stack" style="width:100%">
        <button class="btn green" id="done">Done, you can close this window now 🎄</button>
        <button class="btn ghost light" id="board">See who has found their Secret Santa 👀</button>
      </div>
    </div>
    ${footer()}
  `);
  on('#board', 'click', () => go('#/board'));
  on('#done', 'click', async () => {
    await signOut();
    render(`${logo()}<section class="card festive center"><span class="big-emoji wiggle">🎅</span><h2>Merry Christmas!</h2><p>You can close this window now. To see your Secret Santa again, just open the link and sign in again.</p></section>`);
    window.close();
  });
}

/** The kid's result. Already signed out, so there is no way back to the parent's envelope. */
function showKidSecretSanta(r: RevealResult) {
  render(`
    <div class="reveal-stage">
      ${resultCard(r)}
      <p class="muted center" style="color:#dfe8ff">🔒 You've been signed out, so nobody can peek at your grown-up's Secret Santa.</p>
      <div class="stack" style="width:100%"><button class="btn green" id="done">Done 🎄</button></div>
    </div>
  `);
  on('#done', 'click', () => {
    render(`${logo()}
      <section class="card festive center">
        <span class="big-emoji wiggle">🎅</span>
        <h2>Give the phone back to your grown-up</h2>
        <p><b>Grown-up:</b> you were signed out so the kids can't peek at your Secret Santa. Please sign in again to see your own envelope.</p>
      </section>
      <div class="stack"><button class="btn" id="again">Sign in again</button></div>`);
    on('#again', 'click', () => go('#/verify'));
  });
}
