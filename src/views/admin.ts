import { logo, render, esc, go, on, $, busy, showError, spinner, footer, fmtTime, app } from '../ui';
import { api, ApiError, type Board, type Me } from '../api';
import { ADMIN_KEY } from '../auth';
import { unsealPanel } from './board';
import { mountListEditor, draftFromSaved, draftRows, draftText } from './listEditor';

export async function adminView() {
  spinner();
  const me = await api<Me>('/me');
  if (!me.isAdmin) return lockScreen(me);
  const [list, board, { requests }] = await Promise.all([
    api<{ participants: Array<{ id: number; name: string; email: string | null; family: string | null; is_kid: number }>; exclusions: Array<{ a: string; b: string }> }>('/admin/participants'),
    api<Board>('/board'),
    api<{ requests: AccessRequest[] }>('/admin/access-requests'),
  ]);
  const draft = me.game.status !== 'started';
  const check =
    draft && list.participants.length
      ? await api<{ ok: boolean; relaxed: string[]; error?: string }>('/admin/draw-check').catch(() => null)
      : null;
  const started = me.game.status === 'started';
  const shareUrl = location.origin + '/';
  const waText = encodeURIComponent(`🎅 Ho ho ho, Berlin Mallus! Secret Santa is live. Open the link, sign in with Google and find out who you're gifting 🎁\n${shareUrl}`);
  const done = board.participants.filter((p) => p.revealed).length;

  render(`
    ${logo('Admin panel 🛠')}
    <section class="card festive">
      <h2>Game status <span class="pill ${me.game.status}">${started ? 'Started' : 'Draft'}</span></h2>
      <p>${board.participants.filter((p) => !p.isKid).length} adults · ${board.participants.filter((p) => p.isKid).length} kids · ${done} envelopes opened</p>
      <label for="share">Link to share in WhatsApp</label>
      <div class="share">
        <input id="share" readonly value="${esc(shareUrl)}" />
        <button class="btn small green" id="copy">Copy</button>
      </div>
      <div class="stack" style="margin-top:12px">
        <a class="btn green" style="text-align:center;text-decoration:none" href="https://wa.me/?text=${waText}" target="_blank" rel="noopener">Share on WhatsApp 💬</a>
        <button class="btn ghost" id="board">Open the status board 👀</button>
      </div>
    </section>

    ${
      started
        ? ''
        : `<section class="card">
      <h2>1. Participants</h2>
      <p class="muted">Add each family, then its adults and kids. Family members never get each other, whatever their surnames.
        Adults can sign in with Google: add their <b>Gmail address</b> to recognise them for sure, or leave it empty and Santa matches their <b>Google name</b>, so write the name they use on Google.
        Kids never sign in: their parents open their envelope, and kids only draw kids.</p>
      <div id="editor"></div>
      <p class="error" id="save-err" hidden></p>
      <div class="stack" style="margin-top:12px">
        <p class="dirty" id="dirty" hidden>✏️ Unsaved changes</p>
        <button class="btn green" id="save">Save list 💾</button>
      </div>
    </section>
    <section class="card">
      <h2>2. Start the draw</h2>
      <p>The server runs the draw and seals who is whose Secret Santa. <b>Nobody can see it, you included.</b> The list is locked after this.</p>
      ${checkNote(check)}
      <p class="error" id="start-err" hidden></p>
      <button class="btn" id="start" ${list.participants.filter((p) => !p.is_kid).length < 3 ? 'disabled' : ''}>Start Secret Santa 🎁</button>
    </section>`
    }

    ${requestsCard(requests, started, list.participants.filter((p) => !p.is_kid))}

    ${
      board.participants.some((p) => p.google)
        ? `<section class="card">
      <h2>🔗 Google links</h2>
      <p class="muted">If someone linked the wrong person, unlink it. Everyone will see this in the log.</p>
      <ul class="people">${board.participants
        .filter((p) => p.google)
        .map((p) => `<li><span class="who">${esc(p.name)}<small>${esc(p.google)}</small></span><button class="btn small ghost" data-unlock="${p.id}" data-revealed="${p.revealed ? 1 : 0}">Unlink</button></li>`)
        .join('')}</ul>
      <p class="error" id="unlink-err" hidden></p>
    </section>`
        : ''
    }

    ${
      started
        ? `${unsealPanel(board, me)}
    <section class="card">
      <h2>🚨 Emergency unseal</h2>
      <p class="muted">Only if you really need the full list (for example, someone dropped out). ${board.unseal && !board.unseal.unsealedAt ? '' : `It needs approval from ${board.unseal?.quorum ?? 5} participants, and everyone will see the request.`}</p>
      <p class="error" id="un-err" hidden></p>
      <div class="stack">
        ${!board.unseal || board.unseal.unsealedAt ? '<button class="btn ghost" id="req">Request unseal</button>' : ''}
        ${board.unseal?.approved ? '<button class="btn" id="view">View all Secret Santas 👁</button>' : ''}
      </div>
      <div id="pairs"></div>
    </section>`
        : ''
    }
    <section class="card danger">
      <h2>⚠️ Danger zone: restart</h2>
      <p class="muted"><b>Redraw</b> keeps the list but deletes all Secret Santas, opened envelopes, approvals and the log, and goes back to Draft.
        <b>Wipe everything</b> also deletes the list and Google links. Everyone sees that the game was restarted.</p>
      ${done ? `<p class="error">${done} ${done === 1 ? 'person has' : 'people have'} already opened their envelope. After a restart they get a new Secret Santa.</p>` : ''}
      <label for="reset-word">Type RESET to confirm</label>
      <input id="reset-word" autocomplete="off" autocapitalize="characters" placeholder="RESET" />
      <label for="reset-pw" style="margin-top:8px">Admin password</label>
      <input id="reset-pw" type="password" autocomplete="current-password" />
      <p class="error" id="reset-err" hidden></p>
      <div class="stack" style="margin-top:12px">
        <button class="btn ghost" id="redraw" disabled>Redraw (keep the list) 🔄</button>
        <button class="btn" id="wipe" disabled>Wipe everything 🗑</button>
      </div>
    </section>

    <div class="btn-row">
      ${me.participant ? '<button class="btn ghost light" id="home">My envelope 🎁</button>' : ''}
      <button class="btn ghost light" id="refresh">Refresh 🔄</button>
    </div>
    ${footer('<button class="link" id="lock">🔒 Lock the admin panel</button>')}
  `);

  const armed = () => $<HTMLInputElement>('#reset-word').value.trim() === 'RESET' && !!$<HTMLInputElement>('#reset-pw').value;
  const arm = () => {
    $<HTMLButtonElement>('#redraw').disabled = !armed();
    $<HTMLButtonElement>('#wipe').disabled = !armed();
  };
  on('#reset-word', 'input', arm);
  on('#reset-pw', 'input', arm);
  const reset = (mode: 'redraw' | 'wipe') => async () => {
    const what =
      mode === 'wipe'
        ? 'WIPE EVERYTHING: the list, Secret Santas, Google links and the log are deleted. You paste the list again afterwards.'
        : 'REDRAW: all Secret Santas, opened envelopes, approvals and the log are deleted. The list stays, and you start a new draw.';
    if (!confirm(`${what}\n\nThis can't be undone. Continue?`)) return;
    $('#reset-err').hidden = true;
    try {
      await busy($<HTMLButtonElement>(`#${mode}`), 'Restarting…', () =>
        api('/admin/reset', { body: { mode, password: $<HTMLInputElement>('#reset-pw').value } }),
      );
      adminView();
    } catch (e) {
      showError('#reset-err', e);
    }
  };
  on('#redraw', 'click', reset('redraw'));
  on('#wipe', 'click', reset('wipe'));
  on('#lock', 'click', () => {
    sessionStorage.removeItem(ADMIN_KEY);
    go(me.participant ? '#/home' : '#/');
  });

  // The list editor (families → adults/kids, never-match pairs, raw sheet).
  const savedText = draftText(draftFromSaved(list.participants, list.exclusions));
  const editor = started
    ? null
    : mountListEditor(
        $('#editor'),
        draftFromSaved(list.participants, list.exclusions),
        (d) => {
          $('#dirty').hidden = draftText(d) === savedText;
        },
        () => saveList(),
      );

  on('#copy', 'click', async () => {
    await navigator.clipboard?.writeText(shareUrl).catch(() => {});
    $('#copy').textContent = 'Copied!';
  });
  on('#board', 'click', () => go('#/board'));
  on('#home', 'click', () => go('#/home'));
  on('#refresh', 'click', () => adminView());

  async function saveList() {
    $('#save-err').hidden = true;
    const d = editor!.get();
    const rows = draftRows(d);
    try {
      await busy($<HTMLButtonElement>('#save'), 'Saving…', () =>
        api('/admin/participants', { body: { participants: rows.map(({ name, email, family, kid }) => ({ name, email: email || null, family, kid })), exclusions: d.exclusions } }),
      );
      adminView(); // reloads the saved list into the families and the raw sheet
    } catch (e) {
      showError('#save-err', e);
      $('#save-err').scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
  on('#save', 'click', () => saveList());

  on('#start', 'click', async () => {
    if (!$('#dirty').hidden) return showError('#start-err', new Error('Save the list first: the draw uses the saved list.'));
    if (!confirm(`Start Secret Santa for ${list.participants.length} people (adults and kids are drawn separately)? The list is locked after this.`)) return;
    $('#start-err').hidden = true;
    const start = (acceptLoosened: boolean) =>
      busy($<HTMLButtonElement>('#start'), 'Drawing names… 🎩', () => api('/admin/start', { body: { acceptLoosened } }));
    try {
      try {
        await start(false);
      } catch (e) {
        // 428: the rules can't all be met. Show what would be loosened and ask before starting.
        if (!(e instanceof ApiError && e.status === 428)) throw e;
        const msg = `${e.message}\n\n${(e.details ?? []).map((d) => `• ${d}`).join('\n')}\n\nEveryone will see this in the log. Start anyway?`;
        if (!confirm(msg)) return;
        await start(true);
      }
      adminView();
    } catch (e) {
      showError('#start-err', e);
    }
  });

  document.querySelectorAll<HTMLButtonElement>('[data-unlock]').forEach((b) =>
    b.addEventListener('click', async () => {
      const warn = b.dataset.revealed === '1' ? '\n\n⚠️ This person has already opened their envelope, so whoever linked it may have seen their Secret Santa.' : '';
      if (!confirm(`Unlink this Google account? Everyone will see this in the log.${warn}`)) return;
      $('#unlink-err').hidden = true;
      try {
        await busy(b, 'Unlinking…', () => api('/admin/unlock-claim', { body: { id: Number(b.dataset.unlock) } }));
        adminView();
      } catch (e) {
        // Admin session expired: show the password form again.
        if (e instanceof ApiError && e.adminLocked) return adminView();
        showError('#unlink-err', e);
      }
    }),
  );

  // Access requests: "Link" gives someone on the list this account; "Add as new person" puts them in the editor
  // (Save the list to finish); "Dismiss" deletes the request.
  document.querySelectorAll<HTMLButtonElement>('[data-req-add]').forEach((b) =>
    b.addEventListener('click', () => {
      const r = requests.find((x) => x.id === Number(b.dataset.reqAdd));
      if (!r || !editor) return;
      if (!editor.addAdult(`${r.firstName} ${r.lastName}`, r.email))
        return showError('#req-err', new Error(`${r.firstName} ${r.lastName} is already on the list. Add their email there, or change the name.`));
      $('#req-err').hidden = true;
      b.disabled = true;
      b.textContent = 'Added below ✓ Save the list to finish';
    }),
  );
  document.querySelectorAll<HTMLButtonElement>('[data-req-link]').forEach((b) =>
    b.addEventListener('click', async () => {
      const id = Number(b.dataset.reqLink);
      const r = requests.find((x) => x.id === id)!;
      const pid = Number(app().querySelector<HTMLSelectElement>(`[data-req-person="${id}"]`)!.value);
      const email = app().querySelector<HTMLSelectElement>(`[data-req-email="${id}"]`)?.value ?? r.googleEmail;
      const p = list.participants.find((x) => x.id === pid);
      if (!p) return showError('#req-err', new Error(`Choose who ${r.firstName} ${r.lastName} is on the list.`));
      const replaces = p.email && p.email !== email ? `\n\nThis replaces ${p.email}, which then can't sign in as ${p.name} any more.` : '';
      const unsaved = !started && !$('#dirty').hidden ? '\n\n⚠️ Your unsaved changes to the list below will be lost.' : '';
      if (!confirm(`Link ${email} to ${p.name}? Everyone will see this in the log.${replaces}${unsaved}`)) return;
      $('#req-err').hidden = true;
      try {
        await busy(b, 'Linking…', () => api('/admin/access-requests/link', { body: { id, participantId: pid, email } }));
        adminView();
      } catch (e) {
        if (e instanceof ApiError && e.adminLocked) return adminView();
        showError('#req-err', e);
      }
    }),
  );
  document.querySelectorAll<HTMLButtonElement>('[data-req-dismiss]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Dismiss this request? It is deleted. They can send a new one.')) return;
      try {
        await busy(b, 'Dismissing…', () => api('/admin/access-requests/dismiss', { body: { id: Number(b.dataset.reqDismiss) } }));
        adminView();
      } catch (e) {
        if (e instanceof ApiError && e.adminLocked) return adminView();
        showError('#req-err', e);
      }
    }),
  );

  on('#req', 'click', async () => {
    if (!confirm('Ask the group to approve unsealing ALL Secret Santas? Everyone will see this request.')) return;
    try {
      await api('/admin/unseal/request', { method: 'POST' });
      adminView();
    } catch (e) {
      showError('#un-err', e);
    }
  });

  on('#view', 'click', async () => {
    if (!confirm('Really view all Secret Santas? This is logged for everyone to see.')) return;
    try {
      const { pairs } = await api<{ pairs: Array<{ giver: string; receiver: string; isKid: boolean }> }>('/admin/unsealed');
      const table = (title: string, list: typeof pairs) =>
        list.length
          ? `<h3>${title}</h3><div class="table-wrap pairs"><table><thead><tr><th>Santa</th><th></th><th>gives to</th></tr></thead><tbody>
        ${list.sort((a, b) => a.giver.localeCompare(b.giver)).map((p) => `<tr><td>${esc(p.giver)}</td><td>→</td><td>${esc(p.receiver)}</td></tr>`).join('')}
      </tbody></table></div>`
          : '';
      $('#pairs').innerHTML = table('Adults', pairs.filter((p) => !p.isKid)) + table('🧒 Kids', pairs.filter((p) => p.isKid));
    } catch (e) {
      showError('#un-err', e);
    }
  });
}

type AccessRequest = {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  googleEmail: string;
  googleName: string | null;
  sentAt: string;
};

type ListAdult = { id: number; name: string; email: string | null };

/** Best guess for who a request is: same full name, else a unique first-name fit. */
function guessPerson(r: AccessRequest, adults: ListAdult[]): number | null {
  const norm = (x: string) => x.trim().toLowerCase().replace(/\s+/g, ' ');
  const full = norm(`${r.firstName} ${r.lastName}`);
  const exact = adults.filter((a) => norm(a.name) === full || (r.googleName && norm(a.name) === norm(r.googleName)));
  if (exact.length === 1) return exact[0].id;
  const first = norm(r.firstName);
  const byFirst = adults.filter((a) => norm(a.name) === first || norm(a.name).split(' ')[0] === first);
  return byFirst.length === 1 ? byFirst[0].id : null;
}

/**
 * People who signed in with Google, weren't on the list, and asked to be added.
 * "Link" gives someone already on the list this account (replacing their email): it works during the game too.
 * "Add as new person" puts them in the list editor (before the draw only).
 */
function requestsCard(requests: AccessRequest[], started: boolean, adults: ListAdult[]): string {
  if (!requests.length) return '';
  const sorted = [...adults].sort((a, b) => a.name.localeCompare(b.name));
  return `<section class="card">
    <h2>🙋 Access requests <span class="pill">${requests.length}</span></h2>
    <p class="muted"><b>Link</b> them to their name on the list: the email there is replaced, and they can sign in straight away.
      ${
        started
          ? 'New people can\'t be added while the draw is running (restart with Redraw first).'
          : '<b>Add as new person</b> puts them under Singles in the list below; <b>Save the list</b> to finish.'
      }</p>
    <ul class="people">${requests
      .map((r) => {
        const guess = guessPerson(r, sorted);
        const two = r.googleEmail !== r.email;
        return `<li class="req"><span class="who">${esc(r.firstName)} ${esc(r.lastName)}
          <small>${esc(r.email)}${two ? ` · signed in as ${esc(r.googleEmail)}` : ''}${r.googleName ? ` · Google name: ${esc(r.googleName)}` : ''} · ${esc(fmtTime(r.sentAt))}</small></span>
          <div class="req-link">
            <select data-req-person="${r.id}" aria-label="Who is ${esc(r.firstName)} on the list?">
              <option value="">Who is this on the list?</option>
              ${sorted
                .map(
                  (a) =>
                    `<option value="${a.id}" ${a.id === guess ? 'selected' : ''}>${esc(a.name)} · ${a.email ? esc(a.email) : 'no email'}</option>`,
                )
                .join('')}
            </select>
            ${
              two
                ? `<select data-req-email="${r.id}" aria-label="Which email to link">
                    <option value="${esc(r.googleEmail)}">Link ${esc(r.googleEmail)} (signed in with it)</option>
                    <option value="${esc(r.email)}">Link ${esc(r.email)} (from the form)</option>
                  </select>`
                : ''
            }
          </div>
          <span class="req-actions">
            <button class="btn small green" data-req-link="${r.id}">Link 🔗</button>
            ${started ? '' : `<button class="btn small ghost" data-req-add="${r.id}">Add as new person</button>`}
            <button class="btn small ghost" data-req-dismiss="${r.id}">Dismiss</button>
          </span></li>`;
      })
      .join('')}</ul>
    <p class="error" id="req-err" hidden></p>
  </section>`;
}

/** Result of the server's test draw on the saved list, shown above the Start button. */
function checkNote(check: { ok: boolean; relaxed: string[]; error?: string } | null): string {
  if (!check) return '';
  if (!check.ok) return `<div class="check bad">❌ <b>The draw can't work yet.</b> ${esc(check.error ?? '')}</div>`;
  if (!check.relaxed.length) return '<div class="check good">✅ Test draw OK: everyone gets a Secret Santa, and all rules are kept.</div>';
  return `<div class="check warn">⚠️ <b>Everyone gets a Secret Santa, but not every rule can be kept:</b>
    <ul>${check.relaxed.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
    Change the list to keep all rules, or start anyway and confirm.</div>`;
}

/** Password form. The server checks the password and every admin request; this form is only the way in. */
function lockScreen(me: Me) {
  render(`
    ${logo('Admin panel 🔒')}
    <section class="card festive">
      <h2>Enter the admin password</h2>
      <p class="muted">Every try is shown in the activity log. After 5 wrong tries, wait 15 minutes (20 wrong tries: wait a day).</p>
      <form id="unlock" class="stack">
        <input id="pw" type="password" autocomplete="current-password" aria-label="Admin password" required />
        <p class="error" id="pw-err" hidden></p>
        <button class="btn" type="submit" id="go">Unlock 🔑</button>
      </form>
    </section>
    <div class="btn-row">
      ${me.participant ? '<button class="btn ghost light" id="home">Back to my envelope 🎁</button>' : ''}
    </div>
    ${footer()}
  `);
  $<HTMLInputElement>('#pw').focus();
  on('#home', 'click', () => go('#/home'));
  on('#unlock', 'submit', async (ev) => {
    ev.preventDefault();
    $('#pw-err').hidden = true;
    try {
      const r = await busy($<HTMLButtonElement>('#go'), 'Checking…', () =>
        api<{ token: string }>('/admin/login', { body: { password: $<HTMLInputElement>('#pw').value } }),
      );
      sessionStorage.setItem(ADMIN_KEY, r.token);
      adminView();
    } catch (e) {
      showError('#pw-err', e);
    }
  });
}
