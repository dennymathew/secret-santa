// Matches a Google account name ("Anu Mary Kurian") to names on the participant list ("Anu").

export function nameWords(s: string): string[] {
  return (s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(Boolean);
}

export function findCandidates<T extends { name: string }>(googleName: string, people: T[]): T[] {
  const g = new Set(nameWords(googleName));
  if (g.size === 0) return [];

  // 1) Every word of the list name appears in the Google name
  const full = people.filter((p) => {
    const w = nameWords(p.name);
    return w.length > 0 && w.every((x) => g.has(x));
  });
  if (full.length) return full;

  // 2) Fallback: the list person's first name appears in the Google name, and that first name is unique on the list
  const firstCount = new Map<string, number>();
  for (const p of people) {
    const f = nameWords(p.name)[0];
    if (f) firstCount.set(f, (firstCount.get(f) ?? 0) + 1);
  }
  return people.filter((p) => {
    const f = nameWords(p.name)[0];
    return !!f && firstCount.get(f) === 1 && g.has(f);
  });
}

export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [user, domain] = email.split('@');
  return `${user.slice(0, 2)}***@${domain ?? ''}`;
}

export type SignInMatch<T> =
  | { kind: 'email'; p: T }
  /** `replacesEmail`: this person has an email on the list that was never used, and it gets replaced. */
  | { kind: 'name'; p: T; replacesEmail: boolean }
  | { kind: 'taken'; p: T }
  | { kind: 'ambiguous'; names: string[] }
  | { kind: 'none' };

/**
 * Who is this Google account on the list?
 * 1. Its verified email is on the list (set by the admin, or linked earlier) → that person.
 * 2. Otherwise its Google name matches exactly ONE adult with no email yet → that person (the caller
 *    then locks this email to it, first come first served).
 * 3. Otherwise, exactly ONE matching adult whose email may be replaced (`canReplace`: the admin typed it in
 *    and it was never used to sign in) → that person, and the caller replaces the email.
 * Anything else that matches is already linked → 'taken'. Two or more fits are never guessed between.
 */
export function matchSignIn<T extends { name: string; google_email: string | null }>(
  email: string,
  googleName: string,
  adults: T[],
  canReplace: (p: T) => boolean = () => false,
): SignInMatch<T> {
  const mail = email.trim().toLowerCase();
  const byEmail = adults.find((p) => p.google_email?.toLowerCase() === mail);
  if (byEmail) return { kind: 'email', p: byEmail };
  const c = findCandidates(googleName, adults);
  if (c.length === 0) return { kind: 'none' };
  // People already linked to another account can't be claimed, so they don't make a name ambiguous:
  // "Priya Denny" is Priya when Denny already signed in with his own email.
  const free = c.filter((p) => !p.google_email);
  if (free.length === 1) return { kind: 'name', p: free[0], replacesEmail: false };
  if (free.length > 1) return { kind: 'ambiguous', names: free.map((p) => p.name) };
  // Only when nobody without an email fits: someone whose typed-in email was never used.
  const replaceable = c.filter((p) => p.google_email && canReplace(p));
  if (replaceable.length === 1) return { kind: 'name', p: replaceable[0], replacesEmail: true };
  if (replaceable.length > 1) return { kind: 'ambiguous', names: replaceable.map((p) => p.name) };
  return { kind: 'taken', p: c[0] };
}

/** Adults that share a first name: they can't sign in by name, so they need an email on the list. */
export function sharedFirstNames(names: string[]): string[] {
  const count = new Map<string, string[]>();
  for (const n of names) {
    const f = nameWords(n)[0];
    if (f) count.set(f, [...(count.get(f) ?? []), n]);
  }
  return [...count.values()].filter((v) => v.length > 1).flat();
}

export const isEmail = (s: string) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(s.trim());

export function listFromEnv(v: string | undefined): string[] {
  return (v ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
}
