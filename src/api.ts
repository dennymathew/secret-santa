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

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = await getToken();
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(sessionStorage.getItem(ADMIN_KEY) ? { 'X-Admin-Session': sessionStorage.getItem(ADMIN_KEY)! } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data: any = await res.json().catch(() => ({}));
  if (data.adminLocked) sessionStorage.removeItem(ADMIN_KEY); // expired or invalid: show the password form again
  if (!res.ok)
    throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status, data.details, data.closed, data.adminLocked);
  return data as T;
}

export interface Me {
  signedInWith: 'google';
  /** Unlocked the admin panel with the password (valid admin session). */
  isAdmin: boolean;
  /** On ADMIN_EMAILS: may sign in without being on the list. */
  organizer: boolean;
  /** Has unlocked the admin panel at some point, so can't approve an unseal. */
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
