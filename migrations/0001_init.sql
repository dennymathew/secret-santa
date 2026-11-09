-- Berlin Mallu Santa schema
CREATE TABLE participants (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,
  phone_e164        TEXT NOT NULL UNIQUE,
  family            TEXT,
  is_admin          INTEGER NOT NULL DEFAULT 0,
  google_email      TEXT UNIQUE,
  google_claimed_at TEXT,
  revealed_at       TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Two-way "never match these two"
CREATE TABLE exclusions (
  a_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  b_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  PRIMARY KEY (a_id, b_id)
);

CREATE TABLE game (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','started')),
  started_at TEXT
);
INSERT INTO game (id, status) VALUES (1, 'draft');

-- receiver id is AES-GCM encrypted with MATCH_KEY; AAD = giver id
CREATE TABLE assignments (
  giver_id   INTEGER PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
  ciphertext TEXT NOT NULL,
  iv         TEXT NOT NULL
);

CREATE TABLE unseal_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unsealed_at TEXT
);

CREATE TABLE unseal_approvals (
  request_id     INTEGER NOT NULL REFERENCES unseal_requests(id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  approved_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (request_id, participant_id)
);

-- Public audit log, visible to every signed-in participant
CREATE TABLE events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  type       TEXT NOT NULL,
  actor_name TEXT,
  detail     TEXT
);
