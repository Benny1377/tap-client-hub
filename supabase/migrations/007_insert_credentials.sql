-- Intentionally empty.
--
-- This migration used to insert the firm's vault rows (client portal and bank
-- logins) as literal data. Real credentials must never live in Git, so its
-- contents were removed. The file stays so the migration history keeps this
-- version; it changes nothing when applied.
--
-- The data already exists in the hosted database. Load vault rows through the
-- app or an approved, out-of-repo process, never through a committed file.
select 1;
