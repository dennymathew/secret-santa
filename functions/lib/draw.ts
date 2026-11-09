// Secret Santa draw: each giver gets exactly one receiver, with these rules:
//  - nobody draws themselves
//  - nobody draws someone from their own family
//  - nobody draws across an explicit exclusion pair
//  - no mutual pairs (if A→B then not B→A)

export interface DrawPerson {
  id: number;
  name: string;
  family?: string | null;
}

export class DrawError extends Error {}

export type RandomInt = (maxExclusive: number) => number;

export const secureRandomInt: RandomInt = (max) => {
  // Rejection sampling to avoid modulo bias
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
};

function shuffle<T>(arr: T[], rnd: RandomInt): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function draw(
  people: DrawPerson[],
  exclusions: Array<[number, number]> = [],
  rnd: RandomInt = secureRandomInt,
): Map<number, number> {
  const n = people.length;
  if (n < 3) throw new DrawError('Need at least 3 participants (mutual pairs are not allowed).');

  const ids = people.map((p) => p.id);
  if (new Set(ids).size !== n) throw new DrawError('Duplicate participant ids.');

  const excluded = new Set<string>();
  for (const [a, b] of exclusions) {
    excluded.add(`${a}:${b}`);
    excluded.add(`${b}:${a}`);
  }
  const fam = new Map(people.map((p) => [p.id, (p.family ?? '').trim().toLowerCase() || null]));
  const allowed = (g: number, r: number) =>
    g !== r && !(fam.get(g) && fam.get(g) === fam.get(r)) && !excluded.has(`${g}:${r}`);

  // Every giver needs at least one possible receiver, and every receiver at least one possible giver.
  for (const p of people) {
    if (!ids.some((r) => allowed(p.id, r)))
      throw new DrawError(`Rules are too tight: ${p.name} has nobody they're allowed to draw.`);
    if (!ids.some((g) => allowed(g, p.id)))
      throw new DrawError(`Rules are too tight: nobody is allowed to draw ${p.name}.`);
  }

  const valid = (m: Map<number, number>) => {
    for (const [g, r] of m) if (!allowed(g, r) || m.get(r) === g) return false;
    return true;
  };

  // 1) Rejection sampling over uniform random permutations: every valid draw is equally likely.
  for (let attempt = 0; attempt < 50_000; attempt++) {
    const perm = shuffle(ids, rnd);
    const m = new Map(ids.map((g, i) => [g, perm[i]]));
    if (valid(m)) return m;
  }

  // 2) Fallback for very tight rules: randomized backtracking, most-constrained giver first.
  const givers = shuffle(ids, rnd).sort(
    (a, b) => ids.filter((r) => allowed(a, r)).length - ids.filter((r) => allowed(b, r)).length,
  );
  const result = new Map<number, number>();
  const used = new Set<number>();
  let steps = 0;
  const solve = (i: number): boolean => {
    if (i === givers.length) return true;
    if (++steps > 2_000_000) return false;
    const g = givers[i];
    for (const r of shuffle(ids, rnd)) {
      if (used.has(r) || !allowed(g, r) || result.get(r) === g) continue;
      result.set(g, r);
      used.add(r);
      if (solve(i + 1)) return true;
      result.delete(g);
      used.delete(r);
    }
    return false;
  };
  if (solve(0)) return result;
  throw new DrawError('No valid draw exists with these families and exclusions. Try relaxing a rule.');
}
