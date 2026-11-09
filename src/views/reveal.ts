import { logo, render, esc, go, on, fmtTime, $ } from '../ui';
import { api } from '../api';
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

export async function revealView() {
  render(`
    <div class="reveal-stage">
      <p style="margin:0;font-size:1.1em">Your Secret Santa match is…</p>
      ${GIFT_SVG}
      <div class="drum" aria-hidden="true">🥁</div>
      <div class="countdown" id="count"></div>
    </div>
  `);

  const result = api<{ receiver: string; firstOpenedAt: string; firstTime: boolean }>('/reveal', { method: 'POST' });
  result.catch(() => {}); // handled below

  const gift = $('.gift');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const total = reduced ? 0.5 : 4.2;
  drumRoll(total);
  gift.classList.add('shake');
  if (!reduced) {
    await sleep(1200);
    for (const n of ['3', '2', '1']) {
      $('#count').textContent = n;
      if (n === '2') gift.classList.add('faster');
      await sleep(1000);
    }
  } else await sleep(500);

  let r: Awaited<typeof result>;
  try {
    r = await result;
  } catch (e) {
    render(`${logo()}<section class="card festive center"><span class="big-emoji">🙈</span><h2>Oops</h2><p class="error">${esc(e instanceof Error ? e.message : e)}</p></section><button class="btn" id="back">Back</button>`);
    on('#back', 'click', () => go('#/home'));
    return;
  }

  $('#count').textContent = '';
  gift.classList.add('open');
  confetti();
  await sleep(500);

  render(`
    <div class="reveal-stage">
      <section class="card festive center match-card">
        <span class="big-emoji">🎉</span>
        <p class="muted" style="margin-top:8px">You are Secret Santa for…</p>
        <p class="match-name">✨ ${esc(r.receiver)} ✨</p>
        <p>Shhh… keep it secret! 🤫 Start thinking about the perfect gift 🎁</p>
        <p class="muted">${r.firstTime ? 'Opened just now.' : `First opened on ${esc(fmtTime(r.firstOpenedAt))}.`}</p>
      </section>
      <div class="stack" style="width:100%">
        <button class="btn green" id="done">Done, you can close this window now 🎄</button>
        <button class="btn ghost light" id="board">See who has found their match 👀</button>
      </div>
    </div>
  `);
  on('#board', 'click', () => go('#/board'));
  on('#done', 'click', async () => {
    await signOut();
    render(`${logo()}<section class="card festive center"><span class="big-emoji wiggle">🎅</span><h2>Merry Christmas!</h2><p>You can close this window now. To see your match again, just open the link and verify again.</p></section>`);
    window.close();
  });
}
