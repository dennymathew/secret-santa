import { logo, render, esc, go, spinner, $, showError, redirect } from '../ui';
import { api } from '../api';
import { signOut } from '../auth';

export async function claimView() {
  spinner();
  const data = await api<{ claimed: boolean; googleName?: string; candidates: Array<{ id: number; name: string; taken: boolean }> }>(
    '/google/candidates',
    { method: 'POST', body: {} },
  );
  if (data.claimed) return redirect('#/home');

  const list = data.candidates;
  const body =
    list.length === 0
      ? `<h2>Hmm, who are you? 🤔</h2>
         <p>We couldn't find <b>${esc(data.googleName)}</b> on the list.</p>
         <p class="muted">Please use SMS sign-in, or ask the admin how your name is written on the list.</p>`
      : list.length === 1
        ? `<h2>Are you ${esc(list[0].name)}? 🎅</h2>
           <p class="muted">Signed in with Google as <b>${esc(data.googleName)}</b>. Confirming links this Google account to ${esc(list[0].name)} for good.</p>`
        : `<h2>Which one is you? 🎅</h2>
           <p class="muted">Signed in with Google as <b>${esc(data.googleName)}</b>. Pick yourself. This links your Google account for good.</p>`;

  render(`
    ${logo()}
    <section class="card festive">
      ${body}
      <p class="error" id="err" hidden></p>
      <div class="stack" style="margin-top:12px">
        ${list
          .map((c) =>
            c.taken
              ? `<button class="btn ghost" disabled>${esc(c.name)}: already linked to another Google account</button>`
              : `<button class="btn green" data-id="${c.id}">${list.length === 1 ? `Yes, I'm ${esc(c.name)}` : esc(c.name)}</button>`,
          )
          .join('')}
        <button class="btn ghost" id="out">${list.length ? "No, that's not me" : 'Back'}</button>
      </div>
    </section>
  `);

  document.querySelectorAll<HTMLButtonElement>('button[data-id]').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        b.disabled = true;
        await api('/google/claim', { body: { id: Number(b.dataset.id) } });
        redirect('#/home');
      } catch (e) {
        b.disabled = false;
        showError('#err', e);
      }
    }),
  );
  $('#out').addEventListener('click', async () => {
    await signOut();
    go('#/verify');
  });
}
