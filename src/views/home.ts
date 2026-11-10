import { logo, render, esc, go, on, fmtTime, spinner, redirect } from '../ui';
import { api, type Me } from '../api';
import { signOut } from '../auth';

export async function homeView() {
  spinner();
  const me = await api<Me>('/me');
  if (me.needsClaim) return redirect('#/claim');
  if (!me.participant) return redirect('#/admin'); // an organizer who isn't on the list

  const p = me.participant!;
  const started = me.game.status === 'started';
  let main: string;
  if (!started) {
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
      <p class="match-name" data-match="self">…</p>
      <p class="muted">First opened on ${esc(fmtTime(p.revealedAt))}. If that wasn't you, tell the group!</p>
    </section>`;
  }

  const kids = me.kids ?? [];
  const kidsCard = kids.length
    ? `<section class="card">
      <h2>🧒 Kids' envelopes</h2>
      <p class="muted">${started ? 'Kids give gifts to other kids. Open the envelope together with your kid!' : 'These will be ready once the draw starts.'}</p>
      <div class="stack">
        ${kids
          .map((k) =>
            !started
              ? `<div class="kid-row"><span>🧒 ${esc(k.name)}</span><span class="muted">⏳</span></div>`
              : !k.revealedAt
                ? `<button class="btn green" data-kid="${k.id}">Open ${esc(k.name)}'s envelope 🎁</button>`
                : `<div class="kid-row"><span>🧒 <b>${esc(k.name)}</b> → <span class="kid-match" data-match="${k.id}">…</span></span>
                     <small class="muted">opened ${esc(fmtTime(k.revealedAt))}</small></div>`,
          )
          .join('')}
      </div>
    </section>`
    : '';

  render(`
    ${logo()}
    ${main}
    ${kidsCard}
    <div class="stack">
      ${started ? '<button class="btn ghost light" id="board">See who has found their match 👀</button>' : ''}
    </div>
    <div class="footer-links"><button class="link" id="out">Sign out</button> · <button class="link" id="admin">🛠 Admin</button></div>
  `);

  // Matches already opened are fetched again (they never change).
  if (started) {
    const fill = (sel: string, kidId?: number) =>
      api<{ receiver: string }>('/reveal', { body: kidId ? { kidId } : {} }).then((r) => {
        const el = document.querySelector(sel);
        if (el) el.textContent = sel.includes('self') ? `✨ ${r.receiver} ✨` : r.receiver;
      });
    if (p.revealedAt) fill('[data-match="self"]');
    for (const k of kids) if (k.revealedAt) fill(`[data-match="${k.id}"]`, k.id);
  }

  on('#open', 'click', () => go('#/reveal'));
  document.querySelectorAll<HTMLButtonElement>('[data-kid]').forEach((b) =>
    b.addEventListener('click', () => go(`#/reveal?kid=${b.dataset.kid}`)),
  );
  on('#board', 'click', () => go('#/board'));
  on('#admin', 'click', () => go('#/admin'));
  on('#out', 'click', async () => {
    await signOut();
    go('#/');
  });
}
