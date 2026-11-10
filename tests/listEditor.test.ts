import { describe, it, expect } from 'vitest';
import { draftFromSaved, draftFromText, draftRows, draftText } from '../src/views/listEditor';

describe('admin list editor', () => {
  it('starts with one empty family and an empty Singles group', () => {
    const d = draftFromSaved([], []);
    expect(d.groups.map((g) => g.family)).toEqual(['', null]);
    expect(draftRows(d)).toEqual([]);
  });
  it('groups saved people by family, Singles last, and round-trips through text', () => {
    const d = draftFromSaved(
      [
        { name: 'Chinnu', email: null, family: null, is_kid: 0 },
        { name: 'Denny', email: 'denny@gmail.com', family: 'Mathew', is_kid: 0 },
        { name: 'Aarav', email: null, family: 'mathew', is_kid: 1 },
      ],
      [{ a: 'Denny', b: 'Chinnu' }],
    );
    expect(d.groups.map((g) => [g.family, g.members.map((m) => m.name)])).toEqual([
      ['Mathew', ['Denny', 'Aarav']],
      [null, ['Chinnu']],
    ]);
    expect(draftText(draftFromText(draftText(d)))).toBe(draftText(d));
  });
  it('skips blank rows and never sends an email for kids', () => {
    const d = draftFromSaved([], []);
    d.groups[0] = {
      family: ' Nair ',
      members: [
        { name: ' Anu ', email: ' Anu@Gmail.com ', kid: false },
        { name: '', email: '', kid: false },
        { name: 'Ammu', email: 'oops@gmail.com', kid: true },
      ],
    };
    expect(draftRows(d).map((r) => [r.name, r.email, r.family, r.kid])).toEqual([
      ['Anu', 'anu@gmail.com', 'Nair', false],
      ['Ammu', '', 'Nair', true],
    ]);
  });
});
