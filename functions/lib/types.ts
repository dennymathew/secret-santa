export interface Env {
  DB: D1Database;
  MATCH_KEY: string;
  FIREBASE_PROJECT_ID: string;
  /** Old way to name admins. Read only to move them into the admins table at their first admin sign-in. */
  ADMIN_EMAILS?: string;
  GAME_ENDS_AT?: string;
  UNSEAL_QUORUM?: string;
  DEV_AUTH?: string;
  /** "1" on the test site (Pages preview environment). Ignored on the production branch. */
  TEST_MODE?: string;
  /** Set by Cloudflare Pages: the git branch of this deployment. */
  CF_PAGES_BRANCH?: string;
}

export interface Participant {
  id: number;
  name: string;
  family: string | null;
  /** Family group from the saved list (same number = same family); NULL for singles. */
  family_group: number | null;
  is_kid: number;
  google_email: string | null;
  google_claimed_at: string | null;
  /** First sign-in with google_email. NULL = an email typed into the list that was never used. */
  google_seen_at: string | null;
  revealed_at: string | null;
}

export type Identity = { kind: 'google'; email: string; name: string };
