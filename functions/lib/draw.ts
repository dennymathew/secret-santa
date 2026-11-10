// Secret Santa draw: each giver gets exactly one receiver, with these rules:
//  - nobody draws themselves (always)
//  - nobody draws someone from their own family
//  - nobody draws across an explicit exclusion pair
//  - no mutual pairs (if A→B then not B→A)
// The last three can be loosened by drawPoolsSafe when the list makes them impossible.

export interface DrawPerson {
  id: number;
  name: string;
  family?: string | null;
}

export class DrawError extends Error {}

export type RandomInt = (maxExclusive: number) => number;

export interface Rules {
  family: boolean;
  exclusions: boolean;
  noMutual: boolean;
}
export const STRICT: Rules = { family: true, exclusions: true, noMutual: true };

// Pooled so a draw doesn't call getRandomValues once per number.
const pool = new Uint32Array(256);
let poolPos = pool.length;
export const secureRandomInt: RandomInt = (max) => {
  // Rejection sampling to avoid modulo bias
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  for (;;) {
    if (poolPos === pool.length) {
      crypto.getRandomValues(pool);
      poolPos = 0;
    }
    const v = pool[poolPos++];
    if (v < limit) return v % max;
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

function makeAllowed(people: DrawPerson[], exclusions: Array<[number, number]>, rules: Rules) {
  const excluded = new Set<string>();
  if (rules.exclusions)
    for (const [a, b] of exclusions) {
      excluded.add(`${a}:${b}`);
      excluded.add(`${b}:${a}`);
    }
  const fam = new Map(people.map((p) => [p.id, (p.family ?? '').trim().toLowerCase() || null]));
  return (g: number, r: number) =>
    g !== r && !(rules.family && fam.get(g) && fam.get(g) === fam.get(r)) && !excluded.has(`${g}:${r}`);
}

/** Does a perfect giver→receiver matching exist at all (ignoring the mutual rule)? Fast, exact. */
function hasMatching(ids: number[], allowed: (g: number, r: number) => boolean): boolean {
  const owner = new Map<number, number>();
  const tryGiver = (g: number, seen: Set<number>): boolean => {
    for (const r of ids) {
      if (!allowed(g, r) || seen.has(r)) continue;
      seen.add(r);
      const o = owner.get(r);
      if (o === undefined || tryGiver(o, seen)) {
        owner.set(r, g);
        return true;
      }
    }
    return false;
  };
  return ids.every((g) => tryGiver(g, new Set()));
}

/**
 * Throws unless `m` is a complete, valid draw for exactly these people:
 * everyone gives once, everyone receives once, nobody outside the group, and every active rule holds.
 * Run on every draw before it is saved, as a last safety net.
 */
export function checkAssignment(
  people: DrawPerson[],
  exclusions: Array<[number, number]>,
  m: Map<number, number>,
  rules: Rules = STRICT,
): void {
  const ids = new Set(people.map((p) => p.id));
  const name = new Map(people.map((p) => [p.id, p.name]));
  const allowed = makeAllowed(people, exclusions, rules);
  const received = new Map<number, number>();
  for (const p of people) if (!m.has(p.id)) throw new DrawError(`Safety check failed: ${p.name} has nobody to give to.`);
  for (const [g, r] of m) {
    if (!ids.has(g) || !ids.has(r)) throw new DrawError('Safety check failed: the draw includes someone outside this group.');
    if (!allowed(g, r)) throw new DrawError(`Safety check failed: ${name.get(g)} → ${name.get(r)} breaks a rule.`);
    if (rules.noMutual && m.get(r) === g) throw new DrawError(`Safety check failed: ${name.get(g)} and ${name.get(r)} drew each other.`);
    received.set(r, (received.get(r) ?? 0) + 1);
  }
  for (const p of people)
    if (received.get(p.id) !== 1) throw new DrawError(`Safety check failed: ${p.name} would get ${received.get(p.id) ?? 0} gifts.`);
}

/** One draw under the given rules, or null if none exists (or none was found in time). */
function solve(
  people: DrawPerson[],
  exclusions: Array<[number, number]>,
  rules: Rules,
  rnd: RandomInt,
): Map<number, number> | null {
  const ids = people.map((p) => p.id);
  if (ids.length < (rules.noMutual ? 3 : 2)) return null;
  const allowed = makeAllowed(people, exclusions, rules);
  if (!hasMatching(ids, allowed)) return null;

  const valid = (m: Map<number, number>) => {
    for (const [g, r] of m) if (!allowed(g, r) || (rules.noMutual && m.get(r) === g)) return false;
    return true;
  };

  // 1) Rejection sampling over uniform random permutations: every valid draw is equally likely.
  for (let attempt = 0; attempt < 20_000; attempt++) {
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
  const step = (i: number): boolean => {
    if (i === givers.length) return true;
    if (++steps > 300_000) return false;
    const g = givers[i];
    for (const r of shuffle(ids, rnd)) {
      if (used.has(r) || !allowed(g, r) || (rules.noMutual && result.get(r) === g)) continue;
      result.set(g, r);
      used.add(r);
      if (step(i + 1)) return true;
      result.delete(g);
      used.delete(r);
    }
    return false;
  };
  return step(0) ? result : null;
}

/** Strict draw: all rules, or a DrawError explaining why it's impossible. */
export function draw(
  people: DrawPerson[],
  exclusions: Array<[number, number]> = [],
  rnd: RandomInt = secureRandomInt,
): Map<number, number> {
  const n = people.length;
  if (n < 3) throw new DrawError('Need at least 3 participants (mutual pairs are not allowed).');
  const ids = people.map((p) => p.id);
  if (new Set(ids).size !== n) throw new DrawError('Duplicate participant ids.');
  const allowed = makeAllowed(people, exclusions, STRICT);
  for (const p of people) {
    if (!ids.some((r) => allowed(p.id, r)))
      throw new DrawError(`Rules are too tight: ${p.name} has nobody they're allowed to draw.`);
    if (!ids.some((g) => allowed(g, p.id)))
      throw new DrawError(`Rules are too tight: nobody is allowed to draw ${p.name}.`);
  }
  const m = solve(people, exclusions, STRICT, rnd);
  if (!m) throw new DrawError('No valid draw exists with these families and exclusions. Try relaxing a rule.');
  checkAssignment(people, exclusions, m, STRICT);
  return m;
}

export interface PoolPerson extends DrawPerson {
  isKid: boolean;
}

/**
 * Two independent strict draws: adults give to adults and kids give to kids.
 * Family and exclusion rules apply in both. Having no kids at all is fine.
 */
export function drawPools(
  people: PoolPerson[],
  exclusions: Array<[number, number]> = [],
  rnd: RandomInt = secureRandomInt,
): Map<number, number> {
  const result = new Map<number, number>();
  for (const [label, group] of pools(people)) {
    const ex = exclusionsWithin(group, exclusions);
    try {
      for (const [g, r] of draw(group, ex, rnd)) result.set(g, r);
    } catch (e) {
      if (e instanceof DrawError) throw new DrawError(`${label}: ${e.message}`);
      throw e;
    }
  }
  return result;
}

export interface Relaxation {
  pool: 'Adults' | 'Kids';
  loosened: Array<keyof Rules>;
  message: string;
}

// Least important rule first; the family rule only as a last resort.
const LADDER: Array<Array<keyof Rules>> = [
  [],
  ['noMutual'],
  ['exclusions'],
  ['exclusions', 'noMutual'],
  ['family'],
  ['family', 'noMutual'],
  ['family', 'exclusions'],
  ['family', 'exclusions', 'noMutual'],
];

const RULE_TEXT: Record<keyof Rules, string> = {
  noMutual: 'two people may draw each other (A gives to B and B gives to A)',
  exclusions: 'the extra "never match" pairs are ignored',
  family: 'family members may draw each other',
};

/**
 * Like drawPools, but never fails because of the rules: when a group can't follow all of them,
 * rules are loosened one at a time (least important first) until everyone has a Secret Santa.
 * Each loosening is reported so the admin can confirm it. Only a group of 1 is truly impossible.
 */
export function drawPoolsSafe(
  people: PoolPerson[],
  exclusions: Array<[number, number]> = [],
  rnd: RandomInt = secureRandomInt,
): { assignment: Map<number, number>; relaxed: Relaxation[] } {
  if (new Set(people.map((p) => p.id)).size !== people.length) throw new DrawError('Duplicate participant ids.');
  const assignment = new Map<number, number>();
  const relaxed: Relaxation[] = [];
  for (const [label, group] of pools(people)) {
    if (group.length < 2)
      throw new DrawError(`${label}: ${group[0].name} is the only one, so there's nobody to swap gifts with. Add at least one more.`);
    const ex = exclusionsWithin(group, exclusions);
    let found = false;
    for (const loosened of LADDER) {
      const rules: Rules = { ...STRICT };
      for (const k of loosened) rules[k] = false;
      const m = solve(group, ex, rules, rnd);
      if (!m) continue;
      checkAssignment(group, ex, m, rules);
      for (const [g, r] of m) assignment.set(g, r);
      if (loosened.length)
        relaxed.push({
          pool: label,
          loosened,
          message: `${label}: the rules can't all be met, so ${loosened.map((k) => RULE_TEXT[k]).join(', and ')}.`,
        });
      found = true;
      break;
    }
    // Unreachable for 2+ people (with every rule loosened, any rotation works), but never save a broken draw.
    if (!found) throw new DrawError(`${label}: no draw could be found.`);
  }
  return { assignment, relaxed };
}

function pools(people: PoolPerson[]): Array<['Adults' | 'Kids', PoolPerson[]]> {
  const out: Array<['Adults' | 'Kids', PoolPerson[]]> = [];
  const adults = people.filter((p) => !p.isKid);
  const kids = people.filter((p) => p.isKid);
  if (adults.length) out.push(['Adults', adults]);
  if (kids.length) out.push(['Kids', kids]);
  return out;
}

function exclusionsWithin(group: DrawPerson[], exclusions: Array<[number, number]>) {
  const ids = new Set(group.map((p) => p.id));
  return exclusions.filter(([a, b]) => ids.has(a) && ids.has(b));
}
