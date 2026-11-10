import { logo, render, esc, go, on, $, busy, showError, spinner } from '../ui';
import { api, ApiError, type Board, type Me } from '../api';
import { ADMIN_KEY } from '../auth';
import { unsealPanel } from './board';
import { parseList, rowProblem, formatList, SAMPLE_LIST } from '../listParser';

export async function adminView() {
  spinner();
  const me = await api<Me>('/me');
  if (!me.isAdmin) return lockScreen(me);
  const [list, board] = await Promise.all([
    api<{ participants: Array<{ id: number; name: string; phone_e164: string | null; family: string | null; is_kid: number }>; exclusions: Array<{ a: string; b: string }> }>('/admin/participants'),
    api<Board>('/board'),
  ]);
  const draft = me.game.status !== 'started';
  const check =
    draft && list.participants.length
      ? await api<{ ok: boolean; relaxed: string[]; error?: string }>('/admin/draw-check').catch(() => null)
      : null;
  const started = me.game.status === 'started';
  const shareUrl = location.origin + '/';
  const text = list.participants.length ? formatList(list.participants, list.exclusions) : SAMPLE_LIST;
  const waText = encodeURIComponent(`🎅 Ho ho ho, Berlin Mallus! Secret Santa is live. Open the link, verify your number and find out who you're gifting 🎁\n${shareUrl}`);
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
      <p class="muted">Start each family with <b># Family: any name</b>. Everyone below it is one family, whatever their surnames, and family members never get each other.
        Adults: <b>Name, Phone</b> (+49 or +91). Kids: <b>Kid: Name</b> with no phone. Their parents open their envelope, and kids only draw kids.
        <b># Single</b> is for people with no family here. Lines starting with <b>!</b> are extra "never match" pairs.</p>
      <textarea id="list" spellcheck="false" autocapitalize="off">${esc(text)}</textarea>
      <div class="table-wrap" id="preview" style="margin-top:12px"></div>
      <p class="error" id="save-err" hidden></p>
      <div class="stack" style="margin-top:12px">
        <button class="btn green" id="save">Save list 💾</button>
      </div>
    </section>
    <section class="card">
      <h2>2. Start the draw</h2>
      <p>The server runs the draw and seals the matches. <b>Nobody can see them, you included.</b> The list is locked after this.</p>
      ${checkNote(check)}
      <p class="error" id="start-err" hidden></p>
      <button class="btn" id="start" ${list.participants.filter((p) => !p.is_kid).length < 3 ? 'disabled' : ''}>Start Secret Santa 🎁</button>
    </section>`
    }

    ${
      board.participants.some((p) => p.google)
        ? `<section class="card">
      <h2>🔗 Google links</h2>
      <p class="muted">If someone linked the wrong person, unlink it. Everyone will see this in the log.</p>
      <ul class="people">${board.participants
        .filter((p) => p.google)
        .map((p) => `<li><span class="who">${esc(p.name)}<small>${esc(p.google)}</small></span><button class="btn small ghost" data-unlock="${p.id}" data-revealed="${p.revealed ? 1 : 0}">Unlink</button></li>`)
        .join('')}</ul>
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
        ${board.unseal?.approved ? '<button class="btn" id="view">View all matches 👁</button>' : ''}
      </div>
      <div id="pairs"></div>
    </section>`
        : ''
    }
    <section class="card danger">
      <h2>⚠️ Danger zone: restart</h2>
      <p class="muted"><b>Redraw</b> keeps the list but deletes all matches, opened envelopes, approvals and the log, and goes back to Draft.
        <b>Wipe everything</b> also deletes the list and Google links. Everyone sees that the game was restarted.</p>
      ${done ? `<p class="error">${done} ${done === 1 ? 'person has' : 'people have'} already opened their envelope. After a restart they get a new match.</p>` : ''}
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
    <div class="footer-links"><button class="link" id="lock">🔒 Lock the admin panel</button></div>
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
        ? 'WIPE EVERYTHING: the list, matches, Google links and the log are deleted. You paste the list again afterwards.'
        : 'REDRAW: all matches, opened envelopes, approvals and the log are deleted. The list stays, and you start a new draw.';
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

  const preview = () => {
    const { rows, exclusions } = parseList($<HTMLTextAreaElement>('#list').value);
    const families = new Set(rows.map((r) => r.family?.toLowerCase()).filter(Boolean)).size;
    const kids = rows.filter((r) => r.kid).length;
    const cell = (r: (typeof rows)[number]) => (r.kid ? '🧒 kid' : r.e164 ? esc(r.e164) : `⚠️ ${esc(r.phone || 'missing')}`);
    $('#preview').innerHTML = `<table><thead><tr><th>Family</th><th>Name</th><th>Phone</th></tr></thead><tbody>
      ${rows
        .map((r) => {
          const problem = rowProblem(r, rows);
          return `<tr class="${problem ? 'bad' : ''}"><td>${esc(r.family ?? '–')}</td><td>${esc(r.name)}${problem ? `<br><small>⚠️ ${esc(problem)}</small>` : ''}</td><td>${cell(r)}</td></tr>`;
        })
        .join('')}
      </tbody></table>
      <p class="muted" style="padding:0 10px">${rows.length - kids} adults · ${kids} kids · ${families} families · ${exclusions.length} extra pairs</p>`;
  };
  if (!started) {
    preview();
    on('#list', 'input', preview);
  }

  on('#copy', 'click', async () => {
    await navigator.clipboard?.writeText(shareUrl).catch(() => {});
    $('#copy').textContent = 'Copied!';
  });
  on('#board', 'click', () => go('#/board'));
  on('#home', 'click', () => go('#/home'));
  on('#refresh', 'click', () => adminView());

  on('#save', 'click', async () => {
    $('#save-err').hidden = true;
    const { rows, exclusions } = parseList($<HTMLTextAreaElement>('#list').value);
    try {
      await busy($<HTMLButtonElement>('#save'), 'Saving…', () =>
        api('/admin/participants', { body: { participants: rows.map(({ name, phone, family, kid }) => ({ name, phone, family, kid })), exclusions } }),
      );
      adminView();
    } catch (e) {
      showError('#save-err', e);
    }
  });

  on('#start', 'click', async () => {
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
      const warn = b.dataset.revealed === '1' ? '\n\n⚠️ This person has already opened their envelope, so whoever linked it may have seen the match.' : '';
      if (!confirm(`Unlink this Google account? Everyone will see this in the log.${warn}`)) return;
      await api('/admin/unlock-claim', { body: { id: Number(b.dataset.unlock) } });
      adminView();
    }),
  );

  on('#req', 'click', async () => {
    if (!confirm('Ask the group to approve unsealing ALL matches? Everyone will see this request.')) return;
    try {
      await api('/admin/unseal/request', { method: 'POST' });
      adminView();
    } catch (e) {
      showError('#un-err', e);
    }
  });

  on('#view', 'click', async () => {
    if (!confirm('Really view all matches? This is logged for everyone to see.')) return;
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

/** Result of the server's test draw on the saved list, shown above the Start button. */
function checkNote(check: { ok: boolean; relaxed: string[]; error?: string } | null): string {
  if (!check) return '';
  if (!check.ok) return `<div class="check bad">❌ <b>The draw can't work yet.</b> ${esc(check.error ?? '')}</div>`;
  if (!check.relaxed.length) return '<div class="check good">✅ Test draw OK: everyone gets a match, and all rules are kept.</div>';
  return `<div class="check warn">⚠️ <b>Everyone gets a match, but not every rule can be kept:</b>
    <ul>${check.relaxed.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
    Change the list to keep all rules, or start anyway and confirm.</div>`;
}

/** Password form. The server checks the password and every admin request; this form is only the way in. */
function lockScreen(me: Me) {
  render(`
    ${logo('Admin panel 🔒')}
    <section class="card festive">
      <h2>Enter the admin password</h2>
      <p class="muted">Every try is shown in the activity log. After 5 wrong tries, wait 15 minutes.</p>
      <form id="unlock" class="stack">
        <input id="pw" type="password" autocomplete="current-password" aria-label="Admin password" required />
        <p class="error" id="pw-err" hidden></p>
        <button class="btn" type="submit" id="go">Unlock 🔑</button>
      </form>
    </section>
    <div class="btn-row">
      ${me.participant ? '<button class="btn ghost light" id="home">Back to my envelope 🎁</button>' : ''}
    </div>
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
