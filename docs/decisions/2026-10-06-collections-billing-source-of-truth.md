# 2026-10-06 Collections Uses TAP Hub Billing as the Source of Truth

Status: Approved (Phase 0 brief, 2026-10-06). Named approver: NOT RECORDED; the production approver is still an open operating decision in `PROJECT_INTRO.md`.

Milestone: Collections Phase 0 (read-only discovery). Branch: `codex/collections-phase-0`.

## Context and evidence

All evidence below is from a read-only repository review of `origin/main` at `210a08a2c02215f523acd511c1fb696ac551d393`. The hosted database was not inspected (see "Hosted Supabase inspection" below).

### 1. No invoice or payment ledger exists

- None of the four migration locations or the root SQL files create an invoice, invoice-line, payment, payment-allocation, or collections table.
- No route under `app/api/` reads or writes billing, invoice, or payment data. No `app/billing/` or `app/collections/` page exists.
- No QuickBooks API, OAuth, webhook, SDK, or sync workflow exists. `package-lock.json` has no QuickBooks or Intuit package. QuickBooks appears only as metadata:
  - payroll processor and software options in `components/client-modal.tsx`, `components/client-slideover.tsx`, and `components/worklist-table.tsx`;
  - a non-person processor filter in `app/api/workload/route.ts:80`;
  - `qbLicense` in `lib/types.ts:81`;
  - Vault site labels in `lib/data.ts` and `components/vault-modal.tsx`.
- `tap_hub_project.audit_log` exists, but no application code writes to it.

### 2. `billing_periods` is not a ledger

Production has `billing_periods`, according to the confirmed Phase 0 audit. The repository describes it in two conflicting ways:

| Source | Shape |
| --- | --- |
| `tap_hub_schema.sql:157` (baseline) | `client_service_id`, `period text`, `amount numeric(10,2)`, `invoiced_at`, `paid_at`. No primary key. |
| `supabase/migrations/006_migrate_audit_billing_creds.sql:20` | Drops and recreates the table as `id uuid`, `client_id text`, `period_start`, `period_end`, `status text default 'pending'`, `amount numeric`, `notes`. Grants `SELECT, INSERT, UPDATE, DELETE` to `anon`, `authenticated`, `service_role`. |

Both shapes have the same limits:

- They store one amount per period.
- They have no invoice identity or number and no line items.
- They have no payment records, so they cannot represent a partial payment, an allocation, a reversal, a credit, a void, or a write-off.
- They have no due date to base aging on.
- They keep no history beyond overwritten fields.

No application code reads or writes `billing_periods`. Which shape is live, its row count, and its RLS state are unverified from this checkout.

The two definitions also disagree on the type of `clients.id`: `uuid` in the baseline, `text` in migration 006. Any new foreign key to `clients` depends on the hosted type.

### 3. Existing path for adding Collections access

- `lib/access-policy.ts` is the canonical policy.
- `effectiveModules()` gives Owner and Admin every key in `MODULE_ROUTES`. Staff, Offshore, and Manager users receive only assigned modules that `canonicalModule()` recognizes.
- `Billing` is already registered (`/billing`, alias `billing`). It is assignable in `app/users/page.tsx:18`, but it has no page and no `NAV_ITEMS` entry in `app/layout.tsx`.
- `Collections` is not registered. Assigning it is silently dropped: `effectiveModules("staff", ["Collections"])` returns `[]`.
- `moduleForPathname()` matches routes exactly, with a prefix exception only for `/support/`. As a result, nested routes such as `/billing/invoices` are denied for every role, including Owner and Admin.
- API routes are not covered by `proxy.ts`, which treats `/api/` as public. Each route enforces access itself; `app/api/credentials/route.ts:15-21` is the model to follow: `resolveAccessIdentity()`, then `isPowerUser()` or `modules.includes(...)`.

Adding Collections requires changes in all of these places:

1. `MODULE_ROUTES` and `MODULE_ALIASES` in `lib/access-policy.ts`.
2. Nested-path handling in `moduleForPathname()`.
3. `NAV_ITEMS` in `app/layout.tsx`.
4. `MODULES_LIST` in `app/users/page.tsx`.
5. The new pages.
6. A server-side check in every new route handler.

Owner and Admin users gain the module automatically as soon as it is registered.

### 4. Hosted Supabase inspection is a pending dependency

- The checkout has no `supabase/config.toml`.
- `supabase/.temp/` contains only `cli-latest`, with no linked project reference.
- No `.env*` file is present. File contents were not read; only directory listings were checked.

There is therefore no safe, approved linked project configuration in this checkout, and live schema facts remain unverified.

## Options considered

1. Use QuickBooks as the ledger and sync it into TAP Hub. Rejected for now: no integration exists, and adopting this would put an external system in charge of client-visible collections state.
2. Extend `billing_periods` into a ledger. Rejected: two conflicting shapes, no line or payment identity, broad grants, and unverified live state.
3. Build a new TAP Hub Billing ledger and derive Collections from it. Selected.

## Decision

- TAP Hub Billing is the authoritative source for amounts owed and paid. Collections reads Billing and never changes ledger amounts.
- Source-of-truth order for this feature: **Operations → Billing → Collections → Client 360**.
  - **Operations** (clients, client_services, work_periods) defines who is served and for which periods.
  - **Billing** (invoices, invoice_lines, payments, payment_allocations) defines what is owed and paid.
  - **Collections** (holds, events) acts on Billing balances.
  - **Client 360** only displays the results and must not recompute balances.
- QuickBooks synchronization is deferred to a later integration phase. Phase 1 may store external IDs only, with no tokens, credentials, or sync jobs.
- Owner and Admin receive all modules. Selected staff may receive the Billing or Collections module by assignment.
- Collections escalation and formal-notice approval are Owner/Admin-only, enforced on the server whatever modules are assigned.

## Consequences

- Implementation: Phase 1 adds new ledger tables and leaves `billing_periods` untouched, with no backfill unless a separate decision approves one.
- Security: new tables must not repeat migration 006's `anon` grants. The existing identity fallback must be resolved before Owner/Admin-only financial approvals rely on it (see the Phase 1 contract, risk R1).
- Migration: blocked until one forward-only migration location is chosen (open operating decision).
- Operations: Collections data is only as correct as Billing. A Collections defect must not be "fixed" by editing ledger rows.

## Follow-up

| Item | Owner | Revisit trigger |
| --- | --- | --- |
| Approved read-only hosted schema inspection | Engineer B with project-owner approval | Before the Phase 1 migration is drafted |
| Choose the forward-only migration location | Project owner | Before the Phase 1 migration is drafted |
| QuickBooks sync design | Project owner | After the Phase 1 ledger is released |
