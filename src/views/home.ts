import { logo, render, esc, go, on, fmtTime, spinner } from '../ui';
import { api, type Me } from '../api';
import { signOut } from '../auth';

export async function homeView() {
  spinner();
  const me = await api<Me>('/me');
  if (me.needsClaim) return go('#/claim');
  if (!me.participant && me.isAdmin) return go('#/admin');

  const p = me.participant!;
  let main: string;
  if (me.game.status !== 'started') {
    main = `<section class="card festive center">
      <span class="big-emoji wiggle">⛄</span>
      <h2>Hi, ${esc(p.name)}! 👋</h2>
      <p>The elves are still wrapping. The draw hasn't started yet.</p>
      <p class="muted">Come back when the admin shares the go-ahead in the WhatsApp group.</p>
    </section>`;
  } else if (!p.revealedAt) {
    main = `<section class="card festive center">
      <span class="big-emoji wiggle">🎁</span>
      <h2>Hi, ${esc(p.name)}! 👋</h2>
      <p>Your envelope is ready. Make sure nobody is peeking over your shoulder… 👀</p>
    </section>
    <button class="btn" id="open">Open my envelope 🎁</button>`;
  } else {
    main = `<section class="card festive center">
      <p class="muted" style="margin-top:10px">Hi ${esc(p.name)}, you are Secret Santa for…</p>
      <p class="match-name">✨ … ✨</p>
      <p class="muted">First opened on ${esc(fmtTime(p.revealedAt))}. If that wasn't you, tell the group!</p>
    </section>`;
  }

  render(`
    ${logo()}
    ${main}
    <div class="stack">
      ${me.game.status === 'started' ? '<button class="btn ghost light" id="board">See who has found their match 👀</button>' : ''}
      ${me.isAdmin ? '<button class="btn ghost light" id="admin">Admin panel 🛠</button>' : ''}
    </div>
    <div class="footer-links"><button class="link" id="out">Sign out</button></div>
  `);

  // For someone who has already revealed, fetch the same match again (it never changes).
  if (me.game.status === 'started' && p.revealedAt) {
    api<{ receiver: string }>('/reveal', { method: 'POST' }).then((r) => {
      const el = document.querySelector('.match-name');
      if (el) el.textContent = `✨ ${r.receiver} ✨`;
    });
  }

  on('#open', 'click', () => go('#/reveal'));
  on('#board', 'click', () => go('#/board'));
  on('#admin', 'click', () => go('#/admin'));
  on('#out', 'click', async () => {
    await signOut();
    go('#/');
  });
}
