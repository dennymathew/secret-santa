// Parses the admin's participant list.
//
//   # Family: Mathew        ← everyone below belongs to this family (surnames don't matter)
//   Denny, +4915100000000
//   Kid: Aarav              ← a kid: no phone; parents in the same family open the envelope
//   # Single                ← people below have no family
//   Chinnu, +4916033333333
//   !Anu, Chinnu            ← extra "never match" pair
//   # anything else         ← comment
import { normalizePhone } from '../functions/lib/phone';

export interface ListRow {
  name: string;
  phone: string;
  e164: string | null;
  family: string | null;
  kid: boolean;
  line: number;
}

export function parseList(text: string) {
  const rows: ListRow[] = [];
  const exclusions: Array<[string, string]> = [];
  let family: string | null = null;
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const header = line.match(/^#+\s*(family|familie)\s*[:\-]\s*(.+)$/i);
    if (header) {
      family = header[2].trim() || null;
      return;
    }
    if (/^#+\s*(single|singles|no family)\b/i.test(line)) {
      family = null;
      return;
    }
    if (line.startsWith('#')) return; // comment
    if (line.startsWith('!')) {
      const [a, b] = line.slice(1).split(/[,;\t]/).map((c) => c.trim());
      if (a && b) exclusions.push([a, b]);
      return;
    }
    const kid = line.match(/^(kid|child)\s*:\s*(.+)$/i);
    if (kid) {
      rows.push({ name: kid[2].split(/[,;\t]/)[0].trim(), phone: '', e164: null, family, kid: true, line: i + 1 });
      return;
    }
    const [name = '', phone = ''] = line.split(/[,;\t]/).map((c) => c.trim());
    if (name.toLowerCase() === 'name') return; // header row
    rows.push({ name, phone, e164: normalizePhone(phone), family, kid: false, line: i + 1 });
  });
  return { rows, exclusions };
}

/** Problems that can be spotted before saving (the server checks again). */
export function rowProblem(r: ListRow, rows: ListRow[]): string | null {
  if (!r.name) return 'Name missing';
  if (!r.kid && !r.e164) return 'Phone must start with +49 or +91';
  if (r.kid && !r.family) return 'Kids must be under a # Family: header';
  if (r.kid && !rows.some((a) => !a.kid && a.family?.toLowerCase() === r.family!.toLowerCase()))
    return 'This family has no adult to open the envelope';
  return null;
}

/** Turns a saved list back into the text format. */
export function formatList(
  people: Array<{ name: string; phone_e164: string | null; family: string | null; is_kid: number }>,
  exclusions: Array<{ a: string; b: string }>,
) {
  const groups = new Map<string, typeof people>();
  for (const p of people) {
    const k = p.family ?? '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(p);
  }
  const blocks: string[] = [];
  for (const [fam, list] of [...groups].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))) {
    const lines = [fam ? `# Family: ${fam}` : '# Single'];
    for (const p of list.filter((x) => !x.is_kid)) lines.push(`${p.name}, ${p.phone_e164}`);
    for (const p of list.filter((x) => x.is_kid)) lines.push(`Kid: ${p.name}`);
    blocks.push(lines.join('\n'));
  }
  if (exclusions.length) blocks.push(exclusions.map((e) => `!${e.a}, ${e.b}`).join('\n'));
  return blocks.join('\n\n');
}

export const SAMPLE_LIST = `# Family: Mathew
Denny, +4915100000000
Priya, +4915122222222
Kid: Aarav
Kid: Diya

# Family: Nair-Kurian
Anu, +4915111111111
Biju, +919847222222
Kid: Ammu

# Single
Chinnu, +4916033333333

# Extra "never match" pairs start with !
!Anu, Chinnu`;
