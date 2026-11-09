/** Turns user input into E.164 (+49… or +91…). Returns null if it's invalid or from another country. */
export function normalizePhone(input: string): string | null {
  let s = (input ?? '').trim().replace(/[\s\-().\/]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (!/^\+\d+$/.test(s)) return null;
  // Germany: +49 then 6–13 digits (trunk 0 removed if someone typed +490151…)
  if (s.startsWith('+490')) s = '+49' + s.slice(4);
  if (/^\+49\d{6,13}$/.test(s)) return s;
  // India: +91 then a 10-digit mobile number starting with 6–9
  if (s.startsWith('+910')) s = '+91' + s.slice(4);
  if (/^\+91[6-9]\d{9}$/.test(s)) return s;
  return null;
}

export function listFromEnv(v: string | undefined): string[] {
  return (v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
}
