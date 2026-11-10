import { logo, render, esc, go, spinner, $, showError, redirect, footer } from '../ui';
import { api } from '../api';
import { signOut } from '../auth';

type SignInCheck = {
  claimed: boolean;
  googleName?: string;
  organizer?: boolean;
  /** Who to ask to be added to the list. */
  organizerName?: string;
  result?: 'name' | 'taken' | 'ambiguous' | 'none';
  candidate?: { id: number; name: string } | null;
  /** The candidate has an email on the list that was never used: confirming replaces it with this account. */
  replacesEmail?: boolean;
};

/** Shown when this Google email isn't on the list yet: confirm who you are once, or Santa can't find you. */
export async function claimView() {
  spinner();
  const data = await api<SignInCheck>('/google/match', { method: 'POST', body: {} });
  if (data.claimed) return redirect('#/home');
  const who = `<b>${esc(data.googleName || 'this Google account')}</b>`;
  const ask = esc(data.organizerName || 'the admin');
  const c = data.candidate;

  const notFound = (why = '') => `<span class="big-emoji">🎅</span>
    <h2>Santa couldn't find you on the Berlin Mallu list</h2>
    ${why ? `<p>${why}</p>` : ''}
    <p>Please ask <b>${ask}</b> to add you.</p>`;

  const buttons = (yes: boolean) => `
    <p class="error" id="err" hidden></p>
    <div class="stack" style="margin-top:12px">
      ${yes && c ? `<button class="btn green" id="yes">Yes, I'm ${esc(c.name)}</button><button class="btn ghost" id="no">No, that's not me</button>` : ''}
      ${data.organizer ? `<button class="btn" id="admin">Open the admin panel 🛠</button>` : ''}
      ${yes ? '' : '<button class="btn ghost" id="other">Try another Google account</button>'}
    </div>`;

  const show = (body: string, yes: boolean) => {
    render(`
      ${logo()}
      <section class="card festive ${yes ? '' : 'center'}">
        ${body}
        ${buttons(yes)}
      </section>
      ${footer()}
    `);
    if (data.organizer) $('#admin').addEventListener('click', () => go('#/admin'));
    if (!yes) {
      $('#other').addEventListener('click', async () => {
        await signOut();
        go('#/verify');
      });
      return;
    }
    $<HTMLButtonElement>('#yes').addEventListener('click', async (e) => {
      const b = e.currentTarget as HTMLButtonElement;
      try {
        b.disabled = true;
        await api('/google/claim', { body: { id: c!.id } });
        redirect('#/home');
      } catch (err) {
        b.disabled = false;
        showError('#err', err);
      }
    });
    // "No" doesn't sign out: it says who to ask, and offers another Google account.
    $('#no').addEventListener('click', () => show(notFound(`You signed in with Google as ${who}.`), false));
  };

  if (data.result === 'name' && c) {
    show(
      `<h2>Are you ${esc(c.name)}? 🎅</h2>
       <p class="muted">You signed in with Google as ${who}. Confirming links this Google account to ${esc(c.name)} for good${
         data.replacesEmail ? ', instead of the email on the list' : ''
       }.</p>`,
      true,
    );
    return;
  }
  show(
    notFound(
      `You signed in with Google as ${who}. ${
        data.result === 'taken' && c
          ? `${esc(c.name)} on the list is already linked to another Google account.`
          : data.result === 'ambiguous'
            ? "More than one person on the list has that name, so Santa can't tell which one is you."
            : "Your Google email and name don't match anyone on the list."
      }`,
    ),
    false,
  );
}
