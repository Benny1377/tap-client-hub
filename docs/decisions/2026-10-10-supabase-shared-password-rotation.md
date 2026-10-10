# Security action: retire the exposed shared Supabase password

Status: **Owner action required before Phase 1 production sign-off.**

## Finding

The application blocks the known legacy shared password only in its own `/api/auth/sign-in` route. Supabase Auth's public URL and anon key allow a client to call `signInWithPassword` directly, so that application-level check cannot revoke the credential at Supabase Auth. A valid direct Supabase session may then be used against the application. The repository is public and the legacy credential was present in Git history.

## Required response

1. In Supabase Auth, identify accounts that may still use the exposed shared password. If that cannot be established reliably, treat all active password accounts as affected.
2. Require each affected user to set an individual strong password through an approved reset flow; do not reuse or send a shared replacement password.
3. Review/revoke existing sessions for affected accounts as appropriate, then verify the normal login and password-reset experience.
4. Coordinate any Git-history secret purge separately after credential rotation. Rewriting public Git history is disruptive and must not be done as part of a feature-branch change.
5. Keep the application route hash guard as defense-in-depth, but do not treat it as the credential revocation control.

This action changes live user authentication and must be owned and communicated by the project owner. Codex has not reset passwords, revoked sessions, altered Supabase Auth users, or rewritten Git history.
