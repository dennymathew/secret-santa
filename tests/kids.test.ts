import { describe, it, expect } from 'vitest';
import { drawPools, DrawError, type PoolPerson } from '../functions/lib/draw';
import { parseList, rowProblem, formatList, SAMPLE_LIST } from '../src/listParser';

const people: PoolPerson[] = [
  // Mathew family: 2 adults, 2 kids
  { id: 1, name: 'Denny', family: 'Mathew', isKid: false },
  { id: 2, name: 'Priya', family: 'Mathew', isKid: false },
  { id: 3, name: 'Aarav', family: 'Mathew', isKid: true },
  { id: 4, name: 'Diya', family: 'Mathew', isKid: true },
  // Nair-Kurian family: different surnames, one family
  { id: 5, name: 'Anu Nair', family: 'Nair-Kurian', isKid: false },
  { id: 6, name: 'Biju Kurian', family: 'Nair-Kurian', isKid: false },
  { id: 7, name: 'Ammu', family: 'Nair-Kurian', isKid: true },
  { id: 8, name: 'Chinnu', isKid: false },
  { id: 9, name: 'Eldho', family: 'Thomas', isKid: false },
  { id: 10, name: 'Kuttan', family: 'Thomas', isKid: true },
  { id: 11, name: 'Minnu', family: 'Joseph', isKid: true },
  { id: 12, name: 'Fathima', isKid: false },
];
const byId = new Map(people.map((p) => [p.id, p]));

describe('two pools', () => {
  it('kids only draw kids, adults only draw adults, families stay apart', () => {
    for (let i = 0; i < 1000; i++) {
      const m = drawPools(people);
      expect(m.size).toBe(people.length);
      expect(new Set(m.values()).size).toBe(people.length);
      for (const [g, r] of m) {
        const G = byId.get(g)!, R = byId.get(r)!;
        expect(R.isKid).toBe(G.isKid);
        if (G.family) expect(R.family).not.toBe(G.family);
        expect(m.get(r)).not.toBe(g);
      }
    }
  });

  it('works with no kids at all', () => {
    expect(drawPools(people.filter((p) => !p.isKid)).size).toBe(7);
  });

  it('says which draw is impossible', () => {
    const tooFewKids = people.filter((p) => !p.isKid || p.id === 3 || p.id === 7);
    expect(() => drawPools(tooFewKids)).toThrow(/^Kids:/);
    const siblingsOnly = [...people.filter((p) => !p.isKid), ...people.filter((p) => p.family === 'Mathew' && p.isKid),
      { id: 99, name: 'Tiny', family: 'Mathew', isKid: true }];
    expect(() => drawPools(siblingsOnly)).toThrow(DrawError);
  });
});

describe('admin list format', () => {
  it('groups by # Family: headers, not surnames', () => {
    const { rows, exclusions } = parseList(SAMPLE_LIST);
    const anu = rows.find((r) => r.name === 'Anu')!;
    const biju = rows.find((r) => r.name === 'Biju')!;
    expect(anu.family).toBe('Nair-Kurian');
    expect(biju.family).toBe('Nair-Kurian');
    expect(rows.find((r) => r.name === 'Chinnu')!.family).toBeNull();
    expect(exclusions).toEqual([['Anu', 'Chinnu']]);
  });

  it('reads kids (no email, they never sign in)', () => {
    const { rows } = parseList(SAMPLE_LIST);
    const kids = rows.filter((r) => r.kid);
    expect(kids.map((k) => [k.name, k.family])).toEqual([
      ['Aarav', 'Mathew'],
      ['Diya', 'Mathew'],
      ['Ammu', 'Nair-Kurian'],
    ]);
    expect(rows.every((r) => rowProblem(r, rows) === null)).toBe(true);
  });

  it('flags kids with no family or no adult', () => {
    const { rows } = parseList('# Single\nKid: Lonely\n# Family: Ghost\nKid: Casper');
    expect(rowProblem(rows[0], rows)).toMatch(/Family/);
    expect(rowProblem(rows[1], rows)).toMatch(/no adult/);
  });

  it('round-trips through formatList', () => {
    const { rows, exclusions } = parseList(SAMPLE_LIST);
    const saved = rows.map((r) => ({ name: r.name, email: r.email || null, family: r.family, is_kid: r.kid ? 1 : 0 }));
    const again = parseList(formatList(saved, exclusions.map(([a, b]) => ({ a, b }))));
    const key = (r: { name: string; family: string | null; kid: boolean; email: string }) =>
      JSON.stringify([r.name, r.family, r.kid, r.email]);
    expect(again.rows.map(key).sort()).toEqual(rows.map(key).sort());
    expect(again.exclusions).toEqual(exclusions);
  });
});
