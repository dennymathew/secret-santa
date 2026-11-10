// Base64 helpers shared by the server code (standard base64 and the URL-safe, unpadded variant).

export function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const b64u = (buf: ArrayBuffer | Uint8Array): string =>
  b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const unb64u = (s: string): Uint8Array => unb64(s.replace(/-/g, '+').replace(/_/g, '/'));
