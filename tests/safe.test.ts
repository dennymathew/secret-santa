import { describe, it, expect } from 'vitest';
import { drawPoolsSafe, checkAssignment, DrawError, STRICT, type PoolPerson } from '../functions/lib/draw';

const everyoneOnce = (people: PoolPerson[], m: Map<number, number>) => {
  expect([...m.keys()].sort()).toEqual(people.map((p) => p.id).sort());
  expect([...m.values()].sort()).toEqual(people.map((p) => p.id).sort());
  for (const [g, r] of m) {
    expect(g).not.toBe(r);
    expect(people.find((p) => p.id === g)!.isKid).toBe(people.find((p) => p.id === r)!.isKid);
  }
};

const adults = (n: number, family?: (i: number) => string | null): PoolPerson[] =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `A${i + 1}`, family: family?.(i) ?? null, isKid: false }));

describe('drawPoolsSafe', () => {
  it('keeps every rule when it can', () => {
    const p = adults(8, (i) => (i < 2 ? 'X' : null));
    for (let i = 0; i < 200; i++) {
      const { assignment, relaxed } = drawPoolsSafe(p, [[3, 4]]);
      expect(relaxed).toEqual([]);
      checkAssignment(p, [[3, 4]], assignment, STRICT);
    }
  });

  it('2 kids: allows them to swap rather than leaving them out', () => {
    const p = [...adults(4), { id: 10, name: 'K1', isKid: true }, { id: 11, name: 'K2', isKid: true }];
    const { assignment, relaxed } = drawPoolsSafe(p);
    everyoneOnce(p, assignment);
    expect(relaxed).toEqual([expect.objectContaining({ pool: 'Kids', loosened: ['noMutual'] })]);
  });

  it('drops the extra pairs before touching families', () => {
    // 3 people with one never-match pair: the pair rule can't be kept.
    const p = adults(3);
    const { assignment, relaxed } = drawPoolsSafe(p, [[1, 2]]);
    everyoneOnce(p, assignment);
    expect(relaxed[0].loosened).toEqual(['exclusions']);
  });

  it('a family that is too big: family rule loosened only as a last resort', () => {
    const p = adults(4, (i) => (i < 3 ? 'Big' : null));
    for (let i = 0; i < 100; i++) {
      const { assignment, relaxed } = drawPoolsSafe(p);
      everyoneOnce(p, assignment);
      expect(relaxed[0].loosened[0]).toBe('family');
    }
  });

  it('always finds a match for everyone, for random messy lists', () => {
    for (let run = 0; run < 300; run++) {
      const n = 2 + Math.floor(Math.random() * 20);
      const p = adults(n, () => (Math.random() < 0.6 ? `F${Math.floor(Math.random() * 3)}` : null));
      const ex: Array<[number, number]> = [];
      for (let k = 0; k < n; k++) ex.push([1 + Math.floor(Math.random() * n), 1 + Math.floor(Math.random() * n)]);
      everyoneOnce(p, drawPoolsSafe(p, ex).assignment);
    }
  });

  it('only a group of one is impossible', () => {
    expect(() => drawPoolsSafe([...adults(3), { id: 9, name: 'Solo', isKid: true }])).toThrow(/Solo is the only one/);
  });

  it('the safety check catches a broken draw', () => {
    const p = adults(3);
    expect(() => checkAssignment(p, [], new Map([[1, 2], [2, 3], [3, 2]]))).toThrow(DrawError);
    expect(() => checkAssignment(p, [], new Map([[1, 2], [2, 3]]))).toThrow(/A3 has nobody/);
    expect(() => checkAssignment(p, [], new Map([[1, 2], [2, 1], [3, 3]]))).toThrow(DrawError);
  });
});
