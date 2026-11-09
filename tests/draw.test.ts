import { describe, it, expect } from 'vitest';
import { draw, DrawError, type DrawPerson } from '../functions/lib/draw';

const group: DrawPerson[] = [
  { id: 1, name: 'Anu', family: 'Kurian' },
  { id: 2, name: 'Biju', family: 'Kurian' },
  { id: 3, name: 'Chinnu', family: 'Kurian' },
  { id: 4, name: 'Deepa', family: 'Nair' },
  { id: 5, name: 'Eldho', family: 'Nair' },
  { id: 6, name: 'Fathima' },
  { id: 7, name: 'Gopi' },
  { id: 8, name: 'Hari', family: 'Menon' },
  { id: 9, name: 'Indu', family: 'Menon' },
];
const exclusions: Array<[number, number]> = [[6, 7]];

function checkRules(people: DrawPerson[], ex: Array<[number, number]>, m: Map<number, number>) {
  const fam = new Map(people.map((p) => [p.id, p.family ?? null]));
  expect(m.size).toBe(people.length);
  expect(new Set(m.values()).size).toBe(people.length); // everyone receives exactly once
  for (const [g, r] of m) {
    expect(r).not.toBe(g);
    if (fam.get(g)) expect(fam.get(r)).not.toBe(fam.get(g));
    expect(ex.some(([a, b]) => (a === g && b === r) || (a === r && b === g))).toBe(false);
    expect(m.get(r)).not.toBe(g); // no mutual pairs
  }
}

describe('draw', () => {
  it('follows every rule over 1,000 runs', () => {
    for (let i = 0; i < 1000; i++) checkRules(group, exclusions, draw(group, exclusions));
  });

  it('is case-insensitive for family names', () => {
    const p = [
      { id: 1, name: 'A', family: 'kurian' },
      { id: 2, name: 'B', family: 'Kurian ' },
      { id: 3, name: 'C' },
      { id: 4, name: 'D' },
    ];
    for (let i = 0; i < 200; i++) {
      const m = draw(p);
      expect(m.get(1)).not.toBe(2);
      expect(m.get(2)).not.toBe(1);
    }
  });

  it('gives a fair spread of receivers', () => {
    const counts = new Map<number, number>();
    const runs = 4000;
    for (let i = 0; i < runs; i++) {
      const r = draw(group, exclusions).get(6)!; // Fathima can give to 1,2,3,4,5,8,9
      counts.set(r, (counts.get(r) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual([1, 2, 3, 4, 5, 8, 9]);
    for (const c of counts.values()) expect(c).toBeGreaterThan(runs / 7 / 2);
  });

  it('rejects fewer than 3 people', () => {
    expect(() => draw([{ id: 1, name: 'A' }, { id: 2, name: 'B' }])).toThrow(DrawError);
  });

  it('names the person who has nobody to draw', () => {
    const p = [
      { id: 1, name: 'A', family: 'X' },
      { id: 2, name: 'B', family: 'X' },
      { id: 3, name: 'C', family: 'X' },
      { id: 4, name: 'D' },
    ];
    // D can only give to A, B or C, but A, B and C can only give to D, so it's impossible.
    expect(() => draw(p)).toThrow(DrawError);
    const solo = [
      { id: 1, name: 'A', family: 'X' },
      { id: 2, name: 'B', family: 'X' },
      { id: 3, name: 'C', family: 'X' },
    ];
    expect(() => draw(solo)).toThrow(/A has nobody/);
  });

  it('solves tight but possible setups', () => {
    const p = [1, 2, 3, 4, 5, 6].map((id) => ({ id, name: `P${id}`, family: id <= 3 ? 'big' : null }));
    for (let i = 0; i < 200; i++) checkRules(p, [], draw(p));
  });
});
