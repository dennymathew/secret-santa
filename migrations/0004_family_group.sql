-- Which family group each person belongs to, decided once when the admin saves the list.
-- Kids are opened by the adults with the same family_group, and the draw keeps family members apart
-- by it, so nothing depends on comparing family names in SQL (SQLite only ignores case for A-Z).
-- NULL = no family (singles).
ALTER TABLE participants ADD COLUMN family_group INTEGER;

-- Existing lists: group as before (same family name, ignoring A-Z case). Saving the list again regroups.
UPDATE participants
   SET family_group = (SELECT MIN(p2.id) FROM participants p2 WHERE p2.family = participants.family COLLATE NOCASE)
 WHERE family IS NOT NULL;
