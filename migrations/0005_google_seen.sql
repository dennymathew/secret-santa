-- When this participant's Google email was first used to sign in. An email the admin typed into the list
-- that was never used may be replaced by someone whose Google name fits ("Are you Denny?"). Once used,
-- it stays locked to that person (the admin can still unlink it).
ALTER TABLE participants ADD COLUMN google_seen_at TEXT;

-- Emails already in use: linked by name, or the envelope was opened.
UPDATE participants
   SET google_seen_at = COALESCE(google_claimed_at, revealed_at)
 WHERE google_email IS NOT NULL;
