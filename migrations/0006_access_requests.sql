-- "Request access" from the claim screen: someone signed in with Google but isn't on the list.
-- The admin sees these in the admin panel and adds them to the list. One request per Google account
-- (sending again updates it). A request is removed once its email is on the saved list, or the admin dismisses it.
CREATE TABLE access_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name   TEXT NOT NULL,
  last_name    TEXT NOT NULL,
  email        TEXT NOT NULL,              -- the email they want on the list (filled in with their Google email)
  google_email TEXT NOT NULL UNIQUE,       -- the Google account that sent it
  google_name  TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
