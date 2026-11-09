import { getToken } from './auth';

export class ApiError extends Error {
  constructor(message: string, public status: number, public details?: string[], public closed?: boolean) {
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
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status, data.details, data.closed);
  return data as T;
}

export interface Me {
  signedInWith: 'phone' | 'google';
  isAdmin: boolean;
  participant: { id: number; name: string; revealedAt: string | null } | null;
  needsClaim: boolean;
  game: { status: 'draft' | 'started'; startedAt: string | null; endsAt: string };
}

export interface Board {
  game: Me['game'];
  participants: Array<{ id: number; name: string; revealed: boolean; revealedAt: string | null; google: string | null }>;
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
