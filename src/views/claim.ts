import { logo, render, esc, go, spinner, $, showError, redirect } from '../ui';
import { api } from '../api';
import { signOut } from '../auth';

type Match = {
  claimed: boolean;
  googleName?: string;
  organizer?: boolean;
  result?: 'name' | 'taken' | 'ambiguous' | 'none';
  candidate?: { id: number; name: string } | null;
};

/** Shown when this Google email isn't on the list yet: link by name once, or Santa can't find you. */
export async function claimView() {
  spinner();
  const data = await api<Match>('/google/match', { method: 'POST', body: {} });
  if (data.claimed) return redirect('#/home');
  const who = `<b>${esc(data.googleName || 'this Google account')}</b>`;
  const c = data.candidate;

  const askAdmin = `<p class="muted">Ask the admin to add your Gmail address next to your name on the list, then sign in again.</p>`;
  const body =
    data.result === 'name' && c
      ? `<h2>Are you ${esc(c.name)}? 🎅</h2>
         <p class="muted">You signed in with Google as ${who}. Confirming links this Google account to ${esc(c.name)} for good.</p>`
      : `<span class="big-emoji">🎅</span>
         <h2>Santa couldn't find you on the Berlin Mallu list</h2>
         <p>You signed in with Google as ${who}.
         ${
           data.result === 'taken' && c
             ? `${esc(c.name)} on the list is already linked to another Google account.`
             : data.result === 'ambiguous'
               ? 'More than one person on the list has that name, so Santa can\'t tell which one is you.'
               : "Your Google email and name don't match anyone on the list."
         }</p>
         ${askAdmin}`;

  render(`
    ${logo()}
    <section class="card festive ${data.result === 'name' ? '' : 'center'}">
      ${body}
      <p class="error" id="err" hidden></p>
      <div class="stack" style="margin-top:12px">
        ${data.result === 'name' && c ? `<button class="btn green" id="yes">Yes, I'm ${esc(c.name)}</button>` : ''}
        ${data.organizer ? `<button class="btn" id="admin">Open the admin panel 🛠</button>` : ''}
        <button class="btn ghost" id="out">${data.result === 'name' ? "No, that's not me" : 'Try another Google account'}</button>
      </div>
    </section>
  `);

  if (c && data.result === 'name')
    $<HTMLButtonElement>('#yes').addEventListener('click', async (e) => {
      const b = e.currentTarget as HTMLButtonElement;
      try {
        b.disabled = true;
        await api('/google/claim', { body: { id: c.id } });
        redirect('#/home');
      } catch (err) {
        b.disabled = false;
        showError('#err', err);
      }
    });
  if (data.organizer) $('#admin').addEventListener('click', () => go('#/admin'));
  $('#out').addEventListener('click', async () => {
    await signOut();
    go('#/verify');
  });
}
