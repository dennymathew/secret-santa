export interface Env {
  DB: D1Database;
  MATCH_KEY: string;
  FIREBASE_PROJECT_ID: string;
  ADMIN_PHONES?: string;
  ADMIN_EMAILS?: string;
  GAME_ENDS_AT?: string;
  UNSEAL_QUORUM?: string;
  DEV_AUTH?: string;
}

export interface Participant {
  id: number;
  name: string;
  phone_e164: string;
  family: string | null;
  is_admin: number;
  google_email: string | null;
  google_claimed_at: string | null;
  revealed_at: string | null;
}

export type Identity =
  | { kind: 'phone'; phone: string }
  | { kind: 'google'; email: string; name: string };
