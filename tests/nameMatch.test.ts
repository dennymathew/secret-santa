import { describe, it, expect } from 'vitest';
import { findCandidates, nameWords, maskEmail, matchSignIn, sharedFirstNames, isEmail } from '../functions/lib/nameMatch';
import { parseList, formatList, needEmail } from '../src/listParser';

const list = [
  { id: 1, name: 'Anu' },
  { id: 2, name: 'Biju Kurian' },
  { id: 3, name: 'Biju Nair' },
  { id: 4, name: 'José' },
  { id: 5, name: 'Chinnu' },
];

describe('name matching', () => {
  it('matches a short list name inside a longer Google name', () => {
    expect(findCandidates('Anu Mary Kurian', list).map((p) => p.id)).toEqual([1]);
  });
  it('matches the full name when there are two Bijus', () => {
    expect(findCandidates('Biju Kurian', list).map((p) => p.id)).toEqual([2]);
  });
  it('does not use a first name that appears twice on the list', () => {
    expect(findCandidates('Biju Thomas', list)).toEqual([]);
  });
  it('offers a picker when several list names match', () => {
    expect(findCandidates('Anu Chinnu', list).map((p) => p.id).sort()).toEqual([1, 5]);
  });
  it('ignores case and accents', () => {
    expect(findCandidates('JOSE Mathew', list).map((p) => p.id)).toEqual([4]);
    expect(nameWords('  Dr. Anu-Mary ')).toEqual(['dr', 'anu', 'mary']);
  });
  it('returns nothing for an unrelated name', () => {
    expect(findCandidates('Santa Claus', list)).toEqual([]);
    expect(findCandidates('', list)).toEqual([]);
  });
  it('does not match part of a word', () => {
    expect(findCandidates('Anupama', list)).toEqual([]);
  });
  it('masks emails', () => {
    expect(maskEmail('anu.kurian@gmail.com')).toBe('an***@gmail.com');
  });
});

describe('sign-in matching', () => {
  const adults = [
    { id: 1, name: 'Anu', google_email: null as string | null },
    { id: 2, name: 'Jose', google_email: null },
    { id: 3, name: 'Jose Mathew', google_email: null },
    { id: 4, name: 'Chinnu', google_email: 'chinnu@gmail.com' },
    { id: 5, name: 'Biju', google_email: 'someone.else@gmail.com' },
  ];
  it('uses the email on the list first, whatever the Google name is', () => {
    expect(matchSignIn('Chinnu@Gmail.com', 'Totally Different', adults)).toMatchObject({ kind: 'email', p: { id: 4 } });
  });
  it('matches a single unlinked person by name', () => {
    expect(matchSignIn('anu.k@gmail.com', 'Anu Mary Kurian', adults)).toMatchObject({ kind: 'name', p: { id: 1 } });
  });
  it('refuses when the one matching person is already linked to another account', () => {
    expect(matchSignIn('fake@gmail.com', 'Biju Thomas', adults)).toMatchObject({ kind: 'taken', p: { id: 5 } });
    // the email-listed person can't be taken over by name either
    expect(matchSignIn('fake@gmail.com', 'Chinnu', adults)).toMatchObject({ kind: 'taken', p: { id: 4 } });
  });
  it('ignores people already linked when the Google name contains two list names', () => {
    const fam = [
      { id: 1, name: 'Priya', google_email: null as string | null },
      { id: 2, name: 'Denny', google_email: 'denny@gmail.com' },
    ];
    expect(matchSignIn('priya@gmail.com', 'Priya Denny', fam)).toMatchObject({ kind: 'name', p: { id: 1 } });
  });
  it('never guesses between two people', () => {
    expect(matchSignIn('j@gmail.com', 'Jose Mathew', adults)).toMatchObject({ kind: 'ambiguous' });
  });
  it('returns none for strangers', () => {
    expect(matchSignIn('x@gmail.com', 'Santa Claus', adults)).toEqual({ kind: 'none' });
    expect(matchSignIn('x@gmail.com', '', adults)).toEqual({ kind: 'none' });
  });
});

describe('list format', () => {
  it('reads optional emails and writes them back', () => {
    const { rows } = parseList('# Family: M\nDenny, Denny@Gmail.com\nPriya\nKid: Aarav');
    expect(rows.map((r) => [r.name, r.email, r.kid])).toEqual([['Denny', 'denny@gmail.com', false], ['Priya', '', false], ['Aarav', '', true]]);
    const text = formatList(
      [{ name: 'Denny', email: 'denny@gmail.com', family: 'M', is_kid: 0 }, { name: 'Priya', email: null, family: 'M', is_kid: 0 }],
      [],
    );
    expect(text).toBe('# Family: M\nDenny, denny@gmail.com\nPriya');
  });
  it('flags adults without email who share a first name', () => {
    expect(sharedFirstNames(['Jose', 'Jose Mathew', 'Anu']).sort()).toEqual(['Jose', 'Jose Mathew']);
    const { rows } = parseList('Jose\nJose Mathew, jm@gmail.com\nAnu');
    expect([...needEmail(rows)]).toEqual(['Jose']);
  });
  it('checks email format', () => {
    expect(isEmail('a.b@gmail.com')).toBe(true);
    expect(isEmail('+4915100000000')).toBe(false);
    expect(isEmail('a@b')).toBe(false);
  });
});
