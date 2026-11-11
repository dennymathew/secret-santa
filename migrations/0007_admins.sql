-- Who may sign in to the admin panel (with Google, on the separate admin sign-in page).
-- Managed with scripts/admins.sh (add / remove / list). Admins don't have to be participants.
-- "Wipe everything" in the admin panel never touches this table, so admins can always get back in.
CREATE TABLE admins (
  email    TEXT PRIMARY KEY,           -- lower-case Google email
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
