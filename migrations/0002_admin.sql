-- Admin panel password attempts: for the brute-force limit, and so that anyone
-- who ever unlocked the admin panel can't count towards an unseal quorum.
CREATE TABLE admin_logins (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       TEXT NOT NULL DEFAULT (datetime('now')),
  identity TEXT NOT NULL,            -- "phone:+49…" or "google:email"
  ok       INTEGER NOT NULL          -- 1 = correct password, 0 = wrong
);
CREATE INDEX admin_logins_identity ON admin_logins (identity, ts);
