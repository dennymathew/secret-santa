// Parses the admin's participant list.
//
//   # Family: Mathew        ← everyone below belongs to this family (surnames don't matter)
//   Denny, denny@gmail.com  ← email optional: without one, people sign in by matching their Google name
//   Kid: Aarav              ← a kid: never signs in; parents in the same family open the envelope
//   # Single                ← people below have no family
//   Chinnu
//   !Anu, Chinnu            ← extra "never match" pair
//   # anything else         ← comment
import { isEmail, sharedFirstNames } from '../functions/lib/nameMatch';

export interface ListRow {
  name: string;
  /** Optional Google email (lower-cased); "" if none. */
  email: string;
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
      rows.push({ name: kid[2].split(/[,;\t]/)[0].trim(), email: '', family, kid: true, line: i + 1 });
      return;
    }
    const [name = '', email = ''] = line.split(/[,;\t]/).map((c) => c.trim());
    if (name.toLowerCase() === 'name') return; // header row
    rows.push({ name, email: email.toLowerCase(), family, kid: false, line: i + 1 });
  });
  return { rows, exclusions };
}

/** Problems that can be spotted before saving (the server checks again). */
export function rowProblem(r: ListRow, rows: ListRow[]): string | null {
  if (!r.name) return 'Name missing';
  if (!r.kid && r.email && !isEmail(r.email)) return "That email doesn't look right";
  if (r.kid && !r.family) return 'Kids must be under a # Family: header';
  if (r.kid && !rows.some((a) => !a.kid && a.family?.toLowerCase() === r.family!.toLowerCase()))
    return 'This family has no adult to open the envelope';
  return null;
}

/** Adults without an email who share a first name can't sign in by name: the admin should add emails. */
export function needEmail(rows: ListRow[]): Set<string> {
  const adults = rows.filter((r) => !r.kid);
  const shared = new Set(sharedFirstNames(adults.map((r) => r.name)));
  return new Set(adults.filter((r) => !r.email && shared.has(r.name)).map((r) => r.name));
}

/** Turns a saved list back into the text format. */
export function formatList(
  people: Array<{ name: string; email: string | null; family: string | null; is_kid: number }>,
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
    for (const p of list.filter((x) => !x.is_kid)) lines.push(p.email ? `${p.name}, ${p.email}` : p.name);
    for (const p of list.filter((x) => x.is_kid)) lines.push(`Kid: ${p.name}`);
    blocks.push(lines.join('\n'));
  }
  if (exclusions.length) blocks.push(exclusions.map((e) => `!${e.a}, ${e.b}`).join('\n'));
  return blocks.join('\n\n');
}

export const SAMPLE_LIST = `# Family: Mathew
Denny, denny@gmail.com
Priya
Kid: Aarav
Kid: Diya

# Family: Nair-Kurian
Anu
Biju, biju.nair@gmail.com
Kid: Ammu

# Single
Chinnu

# Extra "never match" pairs start with !
!Anu, Chinnu`;
