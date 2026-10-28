-- Add a distinct category for imported contacts without a current TAP client match.
-- Existing client/internal rows remain valid and client_id stays NULL for unassigned rows.
BEGIN;

-- The production schema had client_id marked NOT NULL; unassigned contacts require a null association.
ALTER TABLE tap_hub_project.contacts
  ALTER COLUMN client_id DROP NOT NULL;

ALTER TABLE tap_hub_project.contacts
  DROP CONSTRAINT IF EXISTS contacts_category_check;

ALTER TABLE tap_hub_project.contacts
  ADD CONSTRAINT contacts_category_check
  CHECK (category IN ('client', 'internal', 'unassigned'));

CREATE INDEX IF NOT EXISTS contacts_category_idx
  ON tap_hub_project.contacts (category);

NOTIFY pgrst, 'reload schema';
COMMIT;
