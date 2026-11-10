import { logo, render, esc, go, on, fmtTime, spinner, showError, footer } from '../ui';
import { api, type Board, type Me } from '../api';

const EVENT_TEXT: Record<string, (a: string, d: string) => string> = {
  game_started: (_a, d) => `🎬 The draw started (${d})`,
  revealed: (a, d) => `🎁 ${a} found their Secret Santa${d ? ` (${d})` : ''}`,
  google_claimed: (a, d) => `🔗 ${a} linked a Google account (${d})`,
  claim_unlocked: (a, d) => `🔓 The admin unlinked ${a}'s Google account (${d})`,
  unseal_requested: () => '🚨 The admin asked to unseal all Secret Santas',
  unseal_approved: (a) => `✋ ${a} approved the unseal`,
  unsealed: () => '👁 The admin viewed all Secret Santas',
  admin_unlocked: (a) => `🔑 ${a} unlocked the admin panel`,
  admin_login_failed: (a) => `🚫 Wrong admin password (${a})`,
  game_reset: (a, d) => `🔄 ${a} restarted the game (${d})`,
};

export function unsealPanel(b: Board, me: Me | null) {
  const u = b.unseal;
  if (!u) return '';
  const pct = Math.min(100, Math.round((u.approvals.length / u.quorum) * 100));
  const iApproved = u.approvals.some((a) => a.id === b.me);
  const canApprove = !!me?.participant && !me.isAdmin && !me.adminEver && !iApproved && !u.unsealedAt;
  return `<section class="card">
    <h2>🚨 Unseal request</h2>
    <p>The admin asked to see <b>all</b> Secret Santas (for example, because someone dropped out). This only works once
      <b>${u.quorum}</b> participants approve.</p>
    <div class="progress" aria-label="Approvals"><div style="width:${pct}%"></div></div>
    <p class="muted">${u.approvals.length} / ${u.quorum} approvals${u.approvals.length ? `: ${u.approvals.map((a) => esc(a.name)).join(', ')}` : ''}</p>
    ${u.unsealedAt ? `<p><b>Unsealed on ${esc(fmtTime(u.unsealedAt))}.</b></p>` : ''}
    ${canApprove ? '<button class="btn" id="approve">I approve unsealing ✋</button><p class="error" id="ap-err" hidden></p>' : ''}
    ${iApproved ? '<p class="muted">✅ You approved this.</p>' : ''}
  </section>`;
}

export async function boardView() {
  spinner();
  const [me, b] = await Promise.all([api<Me>('/me'), api<Board>('/board')]);
  const done = b.participants.filter((p) => p.revealed).length;
  const pct = b.participants.length ? Math.round((done / b.participants.length) * 100) : 0;
  const list = (people: Board['participants']) => `<ul class="people">
        ${people
          .map(
            (p) => `<li class="${p.revealed ? 'done' : ''} ${p.id === b.me ? 'me' : ''}">
              <span class="status" aria-label="${p.revealed ? 'Done' : 'Waiting'}">${p.revealed ? '🎁' : '⏳'}</span>
              <span class="who">${esc(p.name)}${p.id === b.me ? ' (you)' : ''}
                <small>${p.revealed ? `Opened ${esc(fmtTime(p.revealedAt))}` : 'Not yet'}${p.google ? ` · 🔗 ${esc(p.google)}` : ''}</small>
              </span>
            </li>`,
          )
          .join('')}
      </ul>`;
  const kids = b.participants.filter((p) => p.isKid);

  render(`
    ${logo('Everyone sees exactly this, the admin too 👀')}
    <section class="card festive">
      <h2>Who has found their Secret Santa?</h2>
      <div class="progress" aria-label="Progress"><div style="width:${pct}%"></div></div>
      <p class="muted">${done} of ${b.participants.length} envelopes opened</p>
      ${kids.length ? '<h3 class="section-title">Grown-ups</h3>' : ''}
      ${list(b.participants.filter((p) => !p.isKid))}
      ${kids.length ? `<h3 class="section-title">🧒 Kids</h3>${list(kids)}` : ''}
    </section>
    ${unsealPanel(b, me)}
    <section class="card">
      <h2>📜 Activity log</h2>
      <ul class="events">
        ${b.events
          .map((e) => {
            const t = EVENT_TEXT[e.type]?.(esc(e.actor_name ?? ''), esc(e.detail ?? '')) ?? esc(e.type);
            return `<li><time>${esc(fmtTime(e.ts))}</time><span>${t}</span></li>`;
          })
          .join('') || '<li class="muted">Nothing yet.</li>'}
      </ul>
    </section>
    <div class="btn-row">
      <button class="btn ghost light" id="refresh">Refresh 🔄</button>
      <button class="btn ghost light" id="back">Back</button>
    </div>
    ${footer('<button class="link" id="admin">🛠 Admin</button>')}
  `);
  on('#admin', 'click', () => go('#/admin'));

  on('#refresh', 'click', () => boardView());
  on('#back', 'click', () => go(me.participant ? '#/home' : '#/admin'));
  on('#approve', 'click', async () => {
    if (!confirm('Approve letting the admin see ALL Secret Santas?')) return;
    try {
      await api('/unseal/approve', { method: 'POST' });
      boardView();
    } catch (e) {
      showError('#ap-err', e);
    }
  });
}
