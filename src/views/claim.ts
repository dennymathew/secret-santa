import { logo, render, esc, go, spinner, $, showError, redirect, footer, busy, fmtTime } from '../ui';
import { api } from '../api';
import { signOut } from '../auth';

type SignInCheck = {
  claimed: boolean;
  googleName?: string;
  /** The signed-in Google email, to fill in the request form. */
  email?: string;
  /** Why Santa can't find them. (A single name fit is linked on the server straight away: claimed.) */
  result?: 'taken' | 'ambiguous' | 'none';
  candidate?: { id: number; name: string } | null;
  /** This Google account's "Request access" waiting for the admin, if any. */
  request?: AccessRequest | null;
};
type AccessRequest = { firstName: string; email: string; sentAt: string };

/** Shown when this Google account isn't on the list and its name doesn't fit exactly one person. */
export async function claimView() {
  spinner();
  const data = await api<SignInCheck>('/google/match', { method: 'POST', body: {} });
  if (data.claimed) return redirect('#/home');
  const who = `<b>${esc(data.googleName || 'this Google account')}</b>`;
  const c = data.candidate;

  let request = data.request ?? null;
  const notFound = (why = '') => `<span class="big-emoji">🎅</span>
    <h2>Santa couldn't find you on the Berlin Mallu list</h2>
    ${why ? `<p>${why}</p>` : ''}
    ${
      request
        ? `<p class="notice">✅ You asked to be added on ${esc(fmtTime(request.sentAt))}. One of the admins will review it and add you to the list. Then sign in again.</p>`
        : ''
    }
    <div class="stack" style="margin-top:12px">
      <button class="btn green" id="request">${request ? 'Update my request ✏️' : 'Request access 🙋'}</button>
    </div>`;

  const show = (body: string) => {
    render(`
      ${logo()}
      <section class="card festive center">
        ${body}
        <div class="stack" style="margin-top:12px">
          <button class="btn ghost" id="other">Try another Google account</button>
        </div>
      </section>
      ${footer()}
    `);
    $('#other').addEventListener('click', async () => {
      await signOut();
      go('#/verify');
    });
    $('#request').addEventListener('click', () => requestForm(body));
  };

  /** First name and email. The admin sees the request in the admin panel. */
  const requestForm = (back: string) => {
    const first = request?.firstName ?? (data.googleName ?? '').trim().split(/\s+/)[0] ?? '';
    render(`
      ${logo()}
      <section class="card festive">
        <h2>Request access 🙋</h2>
        <p class="muted">One of the admins will review your request and add you to the list. Then sign in again.</p>
        <form id="req-form" class="stack" novalidate>
          <div><label for="rq-first">First name</label><input id="rq-first" autocomplete="given-name" autocapitalize="words" maxlength="60" value="${esc(first)}" required /></div>
          <div><label for="rq-email">Email address</label><input id="rq-email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" maxlength="254" value="${esc(request?.email ?? data.email ?? '')}" required />
            <small class="muted">Sign in with this Google account once you're on the list.</small></div>
          <p class="error" id="rq-err" hidden></p>
          <button class="btn green" type="submit" id="rq-send">Send request</button>
          <button class="btn ghost" type="button" id="rq-cancel">Cancel</button>
        </form>
      </section>
      ${footer()}
    `);
    $('#rq-cancel').addEventListener('click', () => show(back));
    $('#req-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('#rq-err').hidden = true;
      try {
        const r = await busy($<HTMLButtonElement>('#rq-send'), 'Sending…', () =>
          api<{ request: AccessRequest }>('/access-request', {
            body: {
              firstName: $<HTMLInputElement>('#rq-first').value,
              email: $<HTMLInputElement>('#rq-email').value,
            },
          }),
        );
        request = r.request;
        render(`
          ${logo()}
          <section class="card festive center">
            <span class="big-emoji wiggle">🎅</span>
            <h2>Request sent!</h2>
            <p>One of the admins will review it and add you to the list. Then sign in again with <b>${esc(request.email)}</b>.</p>
          </section>
          <div class="stack"><button class="btn ghost light" id="other">Try another Google account</button></div>
          ${footer()}
        `);
        $('#other').addEventListener('click', async () => {
          await signOut();
          go('#/verify');
        });
      } catch (err) {
        showError('#rq-err', err);
      }
    });
  };

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
  );
}
