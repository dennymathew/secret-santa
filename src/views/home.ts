import { logo, render, esc, go, on, fmtTime, spinner, redirect, footer, busy, $ } from '../ui';
import { api, type Me } from '../api';

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
      <p class="muted">Come back when the admin gives the go-ahead.</p>
    </section>`;
  } else if (!p.revealedAt) {
    main = `<section class="card festive center">
      <span class="big-emoji wiggle">🎁</span>
      <h2>Hi, ${esc(p.name)}! 👋</h2>
      <p>Your envelope is ready. Make sure nobody is peeking over your shoulder… 👀</p>
    </section>
    <button class="btn" id="open">Open my envelope 🎁</button>`;
  } else {
    // Hidden until asked for, in case someone else is holding the phone.
    main = `<section class="card festive center">
      <p class="muted" style="margin-top:10px">Hi ${esc(p.name)}, your envelope is open.</p>
      <p class="match-name" id="self-name" hidden></p>
      <button class="btn" id="show-self" aria-expanded="false">Show my Secret Santa 👀</button>
      <p class="muted">First opened on ${esc(fmtTime(p.revealedAt))}. If that wasn't you, tell the group!</p>
    </section>`;
  }

  const kids = me.kids ?? [];
  // Kids' Secret Santas are never shown here: siblings would see each other's. They open only in the handover flow.
  const kidsCard = kids.length
    ? `<section class="card">
      <h2>🧒 Kids' envelopes</h2>
      <p class="muted">${started ? 'Kids give gifts to other kids. Hand the phone to your kid to open their envelope. You are signed out afterwards, so they can\'t peek at yours.' : 'These will be ready once the draw starts.'}</p>
      <div class="stack">
        ${kids
          .map((k) =>
            !started
              ? `<div class="kid-row"><span>🧒 ${esc(k.name)}</span><span class="muted">⏳</span></div>`
              : !k.revealedAt
                ? `<button class="btn green" data-kid="${k.id}">Open ${esc(k.name)}'s envelope 🎁</button>`
                : `<div class="kid-row"><span>🧒 <b>${esc(k.name)}</b></span><small class="muted">opened ${esc(fmtTime(k.revealedAt))}</small></div>
                   <button class="btn ghost" data-kid="${k.id}">Open ${esc(k.name)}'s envelope again</button>`,
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
      ${started ? '<button class="btn ghost light" id="board">See who has found their Secret Santa 👀</button>' : ''}
    </div>
    ${footer('<button class="link" id="admin">🛠 Admin</button>')}
  `);

  let shown = false;
  on('#show-self', 'click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const name = $('#self-name');
    if (shown) {
      name.hidden = true;
      name.textContent = '';
      btn.textContent = 'Show my Secret Santa 👀';
    } else {
      let r: { receiver: string };
      try {
        r = await busy(btn, 'Opening…', () => api<{ receiver: string }>('/reveal', { body: {} }));
      } catch (err) {
        name.textContent = err instanceof Error ? err.message : String(err);
        name.hidden = false;
        return;
      }
      name.textContent = `✨ ${r.receiver} ✨`;
      name.hidden = false;
      btn.textContent = 'Hide it again 🙈';
    }
    shown = !shown;
    btn.setAttribute('aria-expanded', String(shown));
  });

  on('#open', 'click', () => go('#/reveal'));
  document.querySelectorAll<HTMLButtonElement>('[data-kid]').forEach((b) =>
    b.addEventListener('click', () => go(`#/reveal?kid=${b.dataset.kid}`)),
  );
  on('#board', 'click', () => go('#/board'));
  on('#admin', 'click', () => go('#/admin'));
}
