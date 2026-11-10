export const app = () => document.getElementById('app')!;

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function render(html: string) {
  app().innerHTML = `<div class="view">${html}</div>`;
  window.scrollTo({ top: 0 });
}

export const $ = <T extends HTMLElement = HTMLElement>(sel: string) => app().querySelector<T>(sel)!;

export function on(sel: string, ev: string, fn: (e: Event) => void) {
  app().querySelector(sel)?.addEventListener(ev, fn);
}

export function fmtTime(iso: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export const go = (hash: string) => {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = hash;
};

/** Like go(), but replaces the current history entry (for redirects), so Back doesn't land on it again. */
export const redirect = (hash: string) => {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.replace(hash);
};

export const spinner = () => render('<div class="spinner" role="status" aria-label="Loading"></div>');

export function logo(sub = '') {
  return `<header class="logo">
    <h1><svg class="hat" viewBox="0 0 64 56" aria-hidden="true"><path d="M6 46 C18 18 38 4 58 8 C50 16 46 30 46 46Z" fill="#c8102e"/><rect x="2" y="42" width="50" height="12" rx="6" fill="#fff"/><circle cx="58" cy="9" r="6" fill="#fff"/></svg>Berlin Mallu Santa</h1>
    ${sub ? `<p>${sub}</p>` : ''}
  </header>`;
}

/** Disables a button and shows a busy label while `fn` runs. */
export async function busy<T>(btn: HTMLButtonElement, label: string, fn: () => Promise<T>): Promise<T> {
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = label;
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.innerHTML = old;
  }
}

export function showError(sel: string, e: unknown) {
  const el = $(sel);
  const msg = e instanceof Error ? e.message : String(e);
  const details = (e as { details?: string[] })?.details;
  el.innerHTML = esc(msg) + (details?.length ? `<ul>${details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : '');
  el.hidden = false;
}
