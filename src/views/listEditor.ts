// Admin list editor: families with adults and kids, filled in with forms,
// plus a raw sheet (table + text) to check the whole list at a glance.
import { esc } from '../ui';
import { formatList, parseList, rowProblem, needEmail, type ListRow } from '../listParser';

export interface Member {
  name: string;
  email: string; // adults only; always '' for kids
  kid: boolean;
}
export interface Group {
  /** null = the Singles group (people with no family in the game). */
  family: string | null;
  members: Member[];
}
export interface Draft {
  groups: Group[];
  exclusions: Array<[string, string]>;
}

type Saved = Array<{ name: string; email: string | null; family: string | null; is_kid: number }>;

const blankAdult = (): Member => ({ name: '', email: '', kid: false });

/** Always exactly one Singles group, last. Empty families are kept (the admin may still be filling them). */
function normalise(d: Draft): Draft {
  const fams = d.groups.filter((g) => g.family !== null);
  const singles = d.groups.filter((g) => g.family === null).flatMap((g) => g.members);
  return { groups: [...fams, { family: null, members: singles }], exclusions: d.exclusions };
}

export function draftFromSaved(people: Saved, exclusions: Array<{ a: string; b: string }>): Draft {
  const groups = new Map<string, Group>();
  for (const p of people) {
    const key = p.family ? p.family.toLowerCase() : '\0singles';
    if (!groups.has(key)) groups.set(key, { family: p.family, members: [] });
    groups.get(key)!.members.push({ name: p.name, email: p.is_kid ? '' : (p.email ?? ''), kid: !!p.is_kid });
  }
  const list = [...groups.values()];
  if (!list.length) list.push({ family: '', members: [blankAdult()] });
  return normalise({ groups: list, exclusions: exclusions.map((e) => [e.a, e.b]) });
}

export function draftFromText(text: string): Draft {
  const { rows, exclusions } = parseList(text);
  return draftFromSaved(
    rows.map((r) => ({ name: r.name, email: r.email || null, family: r.family, is_kid: r.kid ? 1 : 0 })),
    exclusions.map(([a, b]) => ({ a, b })),
  );
}

/** Rows as the server expects them. Completely empty member rows are skipped. */
export function draftRows(d: Draft): ListRow[] {
  const rows: ListRow[] = [];
  for (const g of d.groups)
    for (const m of g.members) {
      if (!m.name.trim() && !m.email.trim()) continue;
      const family = g.family === null ? null : g.family.trim() || null;
      rows.push({ name: m.name.trim(), email: m.kid ? '' : m.email.trim().toLowerCase(), family, kid: m.kid, line: 0 });
    }
  return rows;
}

export function draftText(d: Draft): string {
  const rows = draftRows(d);
  return formatList(
    rows.map((r) => ({ name: r.name, email: r.email || null, family: r.family, is_kid: r.kid ? 1 : 0 })),
    d.exclusions.map(([a, b]) => ({ a, b })),
  );
}

/** Problems for one member, shown under its row and in the raw sheet. */
function problems(d: Draft) {
  const rows = draftRows(d);
  const shared = needEmail(rows);
  const nameCount = new Map<string, number>();
  for (const r of rows) nameCount.set(r.name.toLowerCase(), (nameCount.get(r.name.toLowerCase()) ?? 0) + 1);
  const famCount = new Map<string, number>();
  for (const g of d.groups) if (g.family?.trim()) famCount.set(g.family.trim().toLowerCase(), (famCount.get(g.family.trim().toLowerCase()) ?? 0) + 1);

  const forMember = (g: Group, m: Member): { text: string; bad: boolean } | null => {
    if (!m.name.trim() && !m.email.trim()) return null; // blank row, ignored on save
    const fam = g.family === null ? null : g.family.trim() || null;
    if (g.family !== null && !fam) return { text: 'Give this family a name', bad: true };
    const row: ListRow = { name: m.name.trim(), email: m.kid ? '' : m.email.trim().toLowerCase(), family: fam, kid: m.kid, line: 0 };
    const p = rowProblem(row, rows);
    if (p) return { text: p, bad: true };
    if ((nameCount.get(row.name.toLowerCase()) ?? 0) > 1) return { text: 'This name is on the list twice. Add a surname or initial', bad: true };
    if (!m.kid && shared.has(row.name)) return { text: 'Shares a first name with someone. Add their email so Santa can tell them apart', bad: false };
    return null;
  };
  const forFamily = (g: Group): string | null =>
    g.family !== null && g.family.trim() && (famCount.get(g.family.trim().toLowerCase()) ?? 0) > 1
      ? 'Two families have this name, so they would be merged into one'
      : null;
  return { forMember, forFamily, rows };
}

/**
 * Mounts the editor into `root`. Typing updates the draft in place (no re-render, so focus stays);
 * adding or removing things re-renders. `onChange` runs after every change.
 */
export function mountListEditor(
  root: HTMLElement,
  initial: Draft,
  onChange: (d: Draft) => void,
  /** Saves the current draft to the server (the admin panel's Save list). Used by "Save this list" in the raw sheet. */
  onSave?: () => Promise<void>,
) {
  let d = normalise(structuredClone(initial));
  let rawEditing = false;
  // Keep the raw sheet open across saves and reloads once the admin opened it.
  const RAW_OPEN = 'bms-raw-open';

  const memberRow = (gi: number, mi: number, m: Member) => `
    <div class="member ${m.kid ? 'kid' : ''}">
      <span class="who-icon" aria-hidden="true">${m.kid ? '🧒' : '🧑'}</span>
      <input data-g="${gi}" data-m="${mi}" data-f="name" value="${esc(m.name)}" placeholder="${m.kid ? "Kid's name" : 'Name (as on Google)'}"
        aria-label="${m.kid ? 'Kid name' : 'Name'}" autocomplete="off" autocapitalize="words" />
      <button class="icon-btn" data-act="del-member" data-g="${gi}" data-m="${mi}" aria-label="Remove ${esc(m.name || 'this person')}">✕</button>
      ${
        m.kid
          ? `<span class="kid-note">Kids never sign in: a parent opens their envelope.</span>`
          : `<input class="email" data-g="${gi}" data-m="${mi}" data-f="email" type="email" inputmode="email" value="${esc(m.email)}"
               placeholder="Gmail address (optional)" aria-label="Email for ${esc(m.name || 'this person')}" autocomplete="off" autocapitalize="off" spellcheck="false" />`
      }
      <small class="hint" data-hint="${gi}-${mi}" hidden></small>
    </div>`;

  const groupCard = (g: Group, gi: number) => {
    const singles = g.family === null;
    const adults = g.members.filter((m) => !m.kid).length;
    const kids = g.members.length - adults;
    return `
    <div class="fam ${singles ? 'singles' : ''}">
      <div class="fam-head">
        ${
          singles
            ? `<h3>🙋 Singles <small>no family in the game</small></h3>`
            : `<span aria-hidden="true">🏠</span>
               <input data-g="${gi}" data-f="family" value="${esc(g.family)}" placeholder="Family name, e.g. Mathew" aria-label="Family name" autocomplete="off" autocapitalize="words" />
               <button class="icon-btn" data-act="del-family" data-g="${gi}" aria-label="Remove this family">🗑</button>`
        }
      </div>
      <small class="hint" data-fhint="${gi}" hidden></small>
      <p class="muted small fam-count">${adults} adult${adults === 1 ? '' : 's'}${singles ? '' : ` · ${kids} kid${kids === 1 ? '' : 's'}`}</p>
      <div class="members">${g.members.map((m, mi) => memberRow(gi, mi, m)).join('')}</div>
      <div class="fam-actions">
        <button class="btn small ghost" data-act="add-adult" data-g="${gi}">＋ Adult</button>
        ${singles ? '' : `<button class="btn small ghost" data-act="add-kid" data-g="${gi}">＋ Kid</button>`}
      </div>
    </div>`;
  };

  const pairOptions = (kid: boolean) =>
    draftRows(d)
      .filter((r) => r.kid === kid && r.name)
      .map((r) => `<option value="${esc(r.name)}">${esc(r.name)}${kid ? ' 🧒' : ''}</option>`)
      .join('');

  const pairsHtml = () => {
    const names = new Set(draftRows(d).map((r) => r.name.toLowerCase()));
    const opts = pairOptions(false) + pairOptions(true);
    return `
      <ul class="pairs-list">${
        d.exclusions.length
          ? d.exclusions
              .map(([a, b], i) => {
                const missing = !names.has(a.toLowerCase()) || !names.has(b.toLowerCase());
                return `<li class="${missing ? 'bad' : ''}"><span>${esc(a)} <b>✕</b> ${esc(b)}${missing ? ' <small>⚠️ not on the list any more</small>' : ''}</span>
                  <button class="icon-btn" data-act="del-pair" data-i="${i}" aria-label="Remove this pair">🗑</button></li>`;
              })
              .join('')
          : '<li class="muted small">No extra pairs. Family members never get each other anyway.</li>'
      }</ul>
      <div class="pair-add">
        <select id="pair-a" aria-label="First person"><option value="">Choose…</option>${opts}</select>
        <span aria-hidden="true">✕</span>
        <select id="pair-b" aria-label="Second person"><option value="">Choose…</option>${opts}</select>
        <button class="btn small ghost" data-act="add-pair">Add</button>
      </div>
      <small class="hint bad" id="pair-err" hidden></small>`;
  };

  const rawHtml = () => {
    const { forMember, rows } = problems(d);
    const lines: string[] = [];
    for (const g of d.groups)
      for (const m of g.members) {
        if (!m.name.trim() && !m.email.trim()) continue;
        const p = forMember(g, m);
        lines.push(`<tr class="${p?.bad ? 'bad' : ''}">
          <td>${esc(g.family === null ? 'Single' : g.family.trim() || '?')}</td>
          <td><b>${m.kid ? '🧒 ' : ''}${esc(m.name)}</b>
            <small class="${m.kid || !m.email.trim() ? 'muted' : 'mail'}">${m.kid ? 'kid' : m.email.trim() ? esc(m.email.trim().toLowerCase()) : 'signs in by Google name'}</small>
            ${p ? `<small class="${p.bad ? 'bad' : 'warn'}">${p.bad ? '❌' : '⚠️'} ${esc(p.text)}</small>` : ''}</td></tr>`);
      }
    const fams = new Set(rows.filter((r) => r.family).map((r) => r.family!.toLowerCase())).size;
    const kids = rows.filter((r) => r.kid).length;
    return `
      <p class="muted small">${rows.length - kids} adults · ${kids} kids · ${fams} families · ${d.exclusions.length} extra pairs</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Family</th><th>Person</th></tr></thead>
        <tbody>${lines.join('') || '<tr><td colspan="2" class="muted">Nobody yet.</td></tr>'}</tbody>
      </table></div>
      ${
        d.exclusions.length
          ? `<p class="muted small" style="margin-top:8px">Never match: ${d.exclusions.map(([a, b]) => `${esc(a)} ✕ ${esc(b)}`).join(' · ')}</p>`
          : ''
      }
      <label for="raw-text" style="margin-top:12px">As text ${rawEditing ? '(editing)' : ''}</label>
      <textarea id="raw-text" spellcheck="false" autocapitalize="off" ${rawEditing ? '' : 'readonly'}>${esc(draftText(d))}</textarea>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn small ghost" data-act="copy-raw">Copy 📋</button>
        ${
          rawEditing
            ? `<button class="btn small green" data-act="save-raw">Save this list 💾</button>
               <button class="btn small ghost" data-act="load-raw">Only fill the form ⬆️</button>
               <button class="btn small ghost" data-act="clear-raw">Clear</button>
               <button class="btn small ghost" data-act="cancel-raw">Cancel</button>`
            : `<button class="btn small ghost" data-act="edit-raw">Paste or edit as text ✏️</button>`
        }
      </div>
      <small class="hint bad" id="raw-err" hidden></small>
      ${rawEditing ? `<p class="muted small" style="margin-top:6px"><b>Save this list</b> replaces the whole list with this text, saves it, and fills in the families above. Format: <b># Family: Name</b> starts a family, <b># Single</b> for people with no family, <b>Name, email</b> for adults (email optional), <b>Kid: Name</b> for kids, <b>!A, B</b> for a never-match pair.</p>` : ''}`;
  };

  function render(focus?: string) {
    const open = sessionStorage.getItem(RAW_OPEN) === '1';
    root.innerHTML = `
      <button class="btn ghost paste-list" data-act="edit-raw">📋 Paste a whole list as text</button>
      <div class="fams">${d.groups.map(groupCard).join('')}</div>
      <button class="btn ghost add-family" data-act="add-family">🏠 ＋ Add a family</button>
      <h3 class="section-title">🚫 Never match these two</h3>
      <div id="pairs-box">${pairsHtml()}</div>
      <details class="raw" ${open || rawEditing ? 'open' : ''}>
        <summary>📋 View the raw list</summary>
        <div id="raw-box">${rawHtml()}</div>
      </details>`;
    root.querySelector('details.raw')!.addEventListener('toggle', (e) =>
      sessionStorage.setItem(RAW_OPEN, (e.currentTarget as HTMLDetailsElement).open ? '1' : '0'),
    );
    refresh(false);
    if (focus) root.querySelector<HTMLElement>(focus)?.focus();
  }

  /** Updates hints, counts, the pair pickers and the raw sheet without touching the inputs being typed in. */
  function refresh(notify = true) {
    const { forMember, forFamily } = problems(d);
    d.groups.forEach((g, gi) => {
      const fh = root.querySelector<HTMLElement>(`[data-fhint="${gi}"]`);
      const f = forFamily(g);
      if (fh) {
        fh.hidden = !f;
        fh.textContent = f ? `❌ ${f}` : '';
        fh.className = 'hint bad';
      }
      g.members.forEach((m, mi) => {
        const el = root.querySelector<HTMLElement>(`[data-hint="${gi}-${mi}"]`);
        if (!el) return;
        const p = forMember(g, m);
        el.hidden = !p;
        el.textContent = p ? `${p.bad ? '❌' : '⚠️'} ${p.text}` : '';
        el.className = `hint ${p?.bad ? 'bad' : 'warn'}`;
      });
    });
    const pairs = root.querySelector('#pairs-box');
    if (pairs && !pairs.contains(document.activeElement)) pairs.innerHTML = pairsHtml();
    const raw = root.querySelector('#raw-box');
    if (raw && !rawEditing) raw.innerHTML = rawHtml();
    if (notify) onChange(d);
  }

  root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    const gi = Number(t.dataset.g);
    if (!t.dataset.f || !d.groups[gi]) return;
    if (t.dataset.f === 'family') d.groups[gi].family = t.value;
    else {
      const m = d.groups[gi].members[Number(t.dataset.m)];
      if (t.dataset.f === 'name') m.name = t.value;
      if (t.dataset.f === 'email') m.email = t.value;
    }
    refresh();
  });

  root.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!b) return;
    e.preventDefault();
    const gi = Number(b.dataset.g);
    const g = d.groups[gi];
    switch (b.dataset.act) {
      case 'add-adult':
      case 'add-kid': {
        g.members.push({ name: '', email: '', kid: b.dataset.act === 'add-kid' });
        render(`[data-g="${gi}"][data-m="${g.members.length - 1}"][data-f="name"]`);
        break;
      }
      case 'del-member': {
        const m = g.members[Number(b.dataset.m)];
        if ((m.name.trim() || m.email.trim()) && !confirm(`Remove ${m.name.trim() || 'this person'} from the list?`)) return;
        g.members.splice(Number(b.dataset.m), 1);
        render();
        break;
      }
      case 'add-family': {
        d.groups.splice(d.groups.length - 1, 0, { family: '', members: [blankAdult()] });
        render(`[data-g="${d.groups.length - 2}"][data-f="family"]`);
        break;
      }
      case 'del-family': {
        const n = g.members.filter((m) => m.name.trim()).length;
        if (n && !confirm(`Remove the family ${g.family?.trim() || ''} and its ${n} member${n === 1 ? '' : 's'}?`)) return;
        d.groups.splice(gi, 1);
        render();
        break;
      }
      case 'add-pair': {
        const a = root.querySelector<HTMLSelectElement>('#pair-a')!.value;
        const c = root.querySelector<HTMLSelectElement>('#pair-b')!.value;
        const err = root.querySelector<HTMLElement>('#pair-err')!;
        const rows = draftRows(d);
        const kidOf = (n: string) => rows.find((r) => r.name === n)?.kid;
        const msg = !a || !c
          ? 'Choose two people.'
          : a === c
            ? 'Choose two different people.'
            : kidOf(a) !== kidOf(c)
              ? 'Kids and adults are in separate draws already.'
              : d.exclusions.some(([x, y]) => (x === a && y === c) || (x === c && y === a))
                ? 'That pair is already there.'
                : '';
        if (msg) {
          err.textContent = msg;
          err.hidden = false;
          return;
        }
        d.exclusions.push([a, c]);
        render();
        break;
      }
      case 'del-pair':
        d.exclusions.splice(Number(b.dataset.i), 1);
        render();
        break;
      case 'copy-raw':
        await navigator.clipboard?.writeText(root.querySelector<HTMLTextAreaElement>('#raw-text')!.value).catch(() => {});
        b.textContent = 'Copied ✅';
        return;
      case 'edit-raw':
        rawEditing = true;
        sessionStorage.setItem(RAW_OPEN, '1');
        render('#raw-text');
        root.querySelector('details.raw')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        return;
      case 'clear-raw': {
        const ta = root.querySelector<HTMLTextAreaElement>('#raw-text')!;
        ta.value = '';
        ta.focus();
        return;
      }
      case 'save-raw': {
        const text = root.querySelector<HTMLTextAreaElement>('#raw-text')!.value;
        const next = draftFromText(text);
        if (!draftRows(next).length) {
          const err = root.querySelector<HTMLElement>('#raw-err')!;
          err.textContent = '❌ Nobody found in this text. Paste the list first.';
          err.hidden = false;
          return;
        }
        rawEditing = false;
        d = next;
        render(); // the families above now show the pasted list, even if saving fails
        onChange(d);
        await onSave?.();
        return;
      }
      case 'cancel-raw':
        rawEditing = false;
        render();
        return;
      case 'load-raw': {
        const text = root.querySelector<HTMLTextAreaElement>('#raw-text')!.value;
        rawEditing = false;
        d = draftFromText(text);
        render();
        break;
      }
      default:
        return;
    }
    onChange(d);
  });

  render();
  return {
    get: () => d,
    /** Adds an adult to Singles (e.g. from an access request). Returns false if that name is already on the list. */
    addAdult(name: string, email: string): boolean {
      if (draftRows(d).some((r) => r.name.toLowerCase() === name.trim().toLowerCase())) return false;
      const singles = d.groups[d.groups.length - 1];
      // Reuse an empty row the admin hasn't filled in yet.
      const blank = singles.members.findIndex((m) => !m.name.trim() && !m.email.trim());
      if (blank >= 0) singles.members.splice(blank, 1);
      singles.members.push({ name: name.trim(), email: email.trim().toLowerCase(), kid: false });
      render();
      onChange(d);
      return true;
    },
  };
}
