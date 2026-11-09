import { describe, it, expect } from 'vitest';
import { findCandidates, nameWords, maskEmail } from '../functions/lib/nameMatch';
import { normalizePhone } from '../functions/lib/phone';

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

describe('phone numbers', () => {
  it('accepts German and Indian mobiles', () => {
    expect(normalizePhone('+49 151 1234 5678')).toBe('+4915112345678');
    expect(normalizePhone('0049-151-12345678')).toBe('+4915112345678');
    expect(normalizePhone('+49 0151 12345678')).toBe('+4915112345678');
    expect(normalizePhone('+91 98470 12345')).toBe('+919847012345');
  });
  it('rejects other countries and junk', () => {
    expect(normalizePhone('+1 415 555 1234')).toBeNull();
    expect(normalizePhone('+91 12345 67890')).toBeNull();
    expect(normalizePhone('015112345678')).toBeNull();
    expect(normalizePhone('hello')).toBeNull();
  });
});
