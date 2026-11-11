import { getToken, ADMIN_KEY } from './auth';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: string[],
    public closed?: boolean,
    public adminLocked?: boolean,
  ) {
    super(message);
  }
}

/**
 * Calls the API. Admin paths (/admin/...) send only the admin session; everything else sends only the
 * participant's Google sign-in. The two are never mixed.
 */
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const isAdminPath = path.startsWith('/admin/');
  const auth: Record<string, string> = {};
  if (isAdminPath) {
    const s = sessionStorage.getItem(ADMIN_KEY);
    if (s) auth['X-Admin-Session'] = s;
  } else {
    const token = await getToken();
    if (token) auth.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...auth },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data: any = await res.json().catch(() => ({}));
  if (data.adminLocked) sessionStorage.removeItem(ADMIN_KEY); // expired, or no longer an admin: sign in again
  if (!res.ok)
    throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status, data.details, data.closed, data.adminLocked);
  return data as T;
}

export interface Me {
  signedInWith: 'google';
  /** Is or was an admin, so can't approve an unseal. */
  adminEver: boolean;
  participant: { id: number; name: string; revealedAt: string | null } | null;
  needsClaim: boolean;
  kids: Array<{ id: number; name: string; revealedAt: string | null }>;
  game: { status: 'draft' | 'started'; startedAt: string | null; endsAt: string };
}

export interface Board {
  game: Me['game'];
  participants: Array<{ id: number; name: string; isKid: boolean; revealed: boolean; revealedAt: string | null; google: string | null }>;
  events: Array<{ ts: string; type: string; actor_name: string | null; detail: string | null }>;
  unseal: null | {
    id: number;
    requestedAt: string;
    unsealedAt: string | null;
    approvals: Array<{ id: number; name: string; approved_at: string }>;
    quorum: number;
    approved: boolean;
  };
  me: number | null;
}
