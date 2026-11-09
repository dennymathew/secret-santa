// AES-GCM sealing of assignments. The key is MATCH_KEY (32 random bytes, base64) and is never stored in the DB.

const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

let cached: { raw: string; key: CryptoKey } | null = null;

export async function getKey(raw: string): Promise<CryptoKey> {
  if (cached?.raw === raw) return cached.key;
  if (!raw) throw new Error('MATCH_KEY is not configured');
  const bytes = unb64(raw);
  if (bytes.length !== 32) throw new Error('MATCH_KEY must be 32 bytes (base64)');
  const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
  cached = { raw, key };
  return key;
}

const aad = (giverId: number) => new TextEncoder().encode(`giver:${giverId}`);

export async function seal(key: CryptoKey, giverId: number, receiverId: number) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(giverId) },
    key,
    new TextEncoder().encode(String(receiverId)),
  );
  return { ciphertext: b64(ct), iv: b64(iv) };
}

export async function unseal(key: CryptoKey, giverId: number, ciphertext: string, iv: string): Promise<number> {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(iv), additionalData: aad(giverId) },
    key,
    unb64(ciphertext),
  );
  return Number(new TextDecoder().decode(pt));
}
