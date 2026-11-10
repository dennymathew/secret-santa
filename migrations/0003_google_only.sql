-- Google-only sign-in: phone numbers are no longer used or stored.
-- SQLite can't drop a UNIQUE column, so the participants table is rebuilt without
-- phone_e164 (and the unused is_admin). Rows that point at participants are backed up
-- first, because dropping the old table cascades to them, and then put back.
PRAGMA defer_foreign_keys = true;

CREATE TABLE _bak_exclusions AS SELECT * FROM exclusions;
CREATE TABLE _bak_assignments AS SELECT * FROM assignments;
CREATE TABLE _bak_unseal_approvals AS SELECT * FROM unseal_approvals;

-- Whoever unlocked the admin panel with their phone keeps that mark under their linked Google account,
-- so they still can't approve an unseal. (Must run while phone_e164 still exists.)
UPDATE admin_logins
   SET identity = 'google:' || (SELECT google_email FROM participants WHERE 'phone:' || phone_e164 = admin_logins.identity)
 WHERE identity LIKE 'phone:%'
   AND EXISTS (SELECT 1 FROM participants WHERE 'phone:' || phone_e164 = admin_logins.identity AND google_email IS NOT NULL);

CREATE TABLE participants_new (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,
  family            TEXT,                     -- group label set by the admin; NULL = single
  is_kid            INTEGER NOT NULL DEFAULT 0, -- kids draw among kids only, and never sign in
  google_email      TEXT UNIQUE,              -- typed in by the admin, or linked once by name
  google_claimed_at TEXT,                     -- set when linked by name (NULL = typed in by the admin)
  revealed_at       TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO participants_new (id, name, family, is_kid, google_email, google_claimed_at, revealed_at, created_at)
  SELECT id, name, family, is_kid, google_email, google_claimed_at, revealed_at, created_at FROM participants;

DROP TABLE participants;
ALTER TABLE participants_new RENAME TO participants;

INSERT OR IGNORE INTO exclusions SELECT * FROM _bak_exclusions;
INSERT OR IGNORE INTO assignments SELECT * FROM _bak_assignments;
INSERT OR IGNORE INTO unseal_approvals SELECT * FROM _bak_unseal_approvals;
DROP TABLE _bak_exclusions;
DROP TABLE _bak_assignments;
DROP TABLE _bak_unseal_approvals;

