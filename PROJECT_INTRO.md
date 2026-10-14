# TAP Client Hub Project Introduction

## Product and users

TAP Client Hub is the role-aware operations dashboard used by TAP Associates. It manages client records, service worklists, timesheets, financial work, payroll, sales tax, tax returns, renditions, annual reports, contacts, Vault metadata, user access, and support tickets.

## Technology and environments

- Next.js App Router, React, TypeScript, Tailwind CSS.
- Primary data: Supabase schema `tap_hub_project`.
- Support tickets: a separate server-only Supabase connection.
- Hosting: Vercel. `origin/main` is the production branch.
- Email: Resend for 2FA and support notifications.

## Source of truth order

1. Approved live production data and access policy.
2. Fetched `origin/main` and the verified Vercel deployment.
3. Executable code and focused regression tests.
4. The canonical schema baseline and applied migration history.
5. Approved product requests and support tickets.
6. Historical plans, backups, demos, and imports for context only.

Do not infer live state from a backup. Verify production deployment separately from a Git push.

## Security and data rules

- Never expose or commit passwords, API keys, database dumps, client exports, or environment values.
- Keep service-role and support-ticket database access in server code.
- Treat Vault values and historical credential imports as sensitive.
- Read production data only with explicit approval and the smallest useful query.
- A production write requires an exact target list, rollback approach, and immediate verification.

## Repository boundaries

- `app/`: pages and route handlers.
- `components/`: shared workflow UI. `components/worklist-table.tsx` is a shared, contested surface.
- `hooks/`: client state and context.
- `lib/access-policy.ts` and `lib/access-server.ts`: access-control policy and server enforcement.
- `lib/supabase/`: browser, server, admin, and ticket database clients.
- `tests/` and `lib/*.test.ts`: focused regression coverage.
- `supabase/migrations/`, `migrations/`, `supabase-migrations/`, and root SQL files: historical migration locations. Do not add a fifth location.

## Open operating decisions

- Name the two human engineering owners and the production approver.
- Choose one forward-only migration location before the next schema change.
- Confirm whether main promotion requires a pull request in every case.
- Establish the Vault long-term credential-storage and rotation policy.
