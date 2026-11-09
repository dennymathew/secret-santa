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
