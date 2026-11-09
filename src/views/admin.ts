import { logo, render, esc, go, on, $, busy, showError, spinner } from '../ui';
import { api, type Board, type Me } from '../api';
import { normalizePhone } from '../../functions/lib/phone';
import { unsealPanel } from './board';

interface Row { name: string; phone: string; family: string; e164: string | null }

export function parseList(text: string) {
  const rows: Row[] = [];
  const exclusions: Array<[string, string]> = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const cells = line.replace(/^!/, '').split(/[,;\t]/).map((c) => c.trim());
    if (line.startsWith('!')) {
      if (cells[0] && cells[1]) exclusions.push([cells[0], cells[1]]);
      continue;
    }
    if (cells[0].toLowerCase() === 'name') continue; // header
    rows.push({ name: cells[0] ?? '', phone: cells[1] ?? '', family: cells[2] ?? '', e164: normalizePhone(cells[1] ?? '') });
  }
  return { rows, exclusions };
}

export async function adminView() {
  spinner();
  const me = await api<Me>('/me');
  if (!me.isAdmin) return go('#/home');
  const [list, board] = await Promise.all([
    api<{ participants: Array<{ id: number; name: string; phone_e164: string; family: string | null }>; exclusions: Array<{ a: string; b: string }> }>('/admin/participants'),
    api<Board>('/board'),
  ]);
  const started = me.game.status === 'started';
  const shareUrl = location.origin + '/';
  const text =
    list.participants.length
      ? 'Name, Phone, Family\n' +
        list.participants.map((p) => [p.name, p.phone_e164, p.family ?? ''].filter((x, i) => i < 2 || x).join(', ')).join('\n') +
        (list.exclusions.length ? '\n' + list.exclusions.map((e) => `!${e.a}, ${e.b}`).join('\n') : '')
      : 'Name, Phone, Family\nAnu Kurian, +4915111111111, Kurian\nBiju Kurian, +919847222222, Kurian\nChinnu, +4916033333333\n# Extra "never match" pairs start with !\n!Anu Kurian, Chinnu';
  const waText = encodeURIComponent(`🎅 Ho ho ho, Berlin Mallus! Secret Santa is live. Open the link, verify your number and find out who you're gifting 🎁\n${shareUrl}`);
  const done = board.participants.filter((p) => p.revealed).length;

  render(`
    ${logo('Admin panel 🛠')}
    <section class="card festive">
      <h2>Game status <span class="pill ${me.game.status}">${started ? 'Started' : 'Draft'}</span></h2>
      <p>${board.participants.length} participants · ${done} opened their envelope</p>
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
      <p class="muted">One person per line: <b>Name, Phone, Family</b>. People in the same family never get each other.
        Phone must start with +49 or +91. Lines starting with <b>!</b> are extra "never match" pairs.</p>
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
      <p class="error" id="start-err" hidden></p>
      <button class="btn" id="start" ${list.participants.length < 3 ? 'disabled' : ''}>Start Secret Santa 🎁</button>
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
    <div class="btn-row">
      ${me.participant ? '<button class="btn ghost light" id="home">My envelope 🎁</button>' : ''}
      <button class="btn ghost light" id="refresh">Refresh 🔄</button>
    </div>
  `);

  const preview = () => {
    const { rows, exclusions } = parseList($<HTMLTextAreaElement>('#list').value);
    const families = new Set(rows.map((r) => r.family.toLowerCase()).filter(Boolean)).size;
    $('#preview').innerHTML = `<table><thead><tr><th>#</th><th>Name</th><th>Phone</th><th>Family</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr class="${r.e164 && r.name ? '' : 'bad'}"><td>${i + 1}</td><td>${esc(r.name)}</td><td>${r.e164 ? esc(r.e164) : `⚠️ ${esc(r.phone)}`}</td><td>${esc(r.family)}</td></tr>`).join('')}
      </tbody></table>
      <p class="muted" style="padding:0 10px">${rows.length} people · ${families} families · ${exclusions.length} extra pairs</p>`;
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
        api('/admin/participants', { body: { participants: rows.map(({ name, phone, family }) => ({ name, phone, family })), exclusions } }),
      );
      adminView();
    } catch (e) {
      showError('#save-err', e);
    }
  });

  on('#start', 'click', async () => {
    if (!confirm(`Start Secret Santa for ${list.participants.length} people? The list is locked after this.`)) return;
    $('#start-err').hidden = true;
    try {
      await busy($<HTMLButtonElement>('#start'), 'Drawing names… 🎩', () => api('/admin/start', { method: 'POST' }));
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
      const { pairs } = await api<{ pairs: Array<{ giver: string; receiver: string }> }>('/admin/unsealed');
      $('#pairs').innerHTML = `<div class="table-wrap pairs" style="margin-top:12px"><table><thead><tr><th>Santa</th><th></th><th>gives to</th></tr></thead><tbody>
        ${pairs.sort((a, b) => a.giver.localeCompare(b.giver)).map((p) => `<tr><td>${esc(p.giver)}</td><td>→</td><td>${esc(p.receiver)}</td></tr>`).join('')}
      </tbody></table></div>`;
    } catch (e) {
      showError('#un-err', e);
    }
  });
}
