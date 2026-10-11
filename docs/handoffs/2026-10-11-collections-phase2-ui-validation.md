# Handoff: Collections Phase 2 integrated UI/API/database validation (Engineer A)

| Field | Value |
| --- | --- |
| Date | 2026-10-11 (firm date 2026-10-10, America/Chicago) |
| Backend under test | `codex/collections-phase2-integration` at `3bec72a` (not modified) |
| Validation branch | `codex/collections-phase2-ui-validation`, local only (not pushed): `3bec72a` plus the UI commits from `codex/collections-phase-2-ui` plus the fixes below |
| Environment | Disposable local Supabase from `tools/collections-local` (Docker Desktop 4.94.0, Supabase CLI 2.120.0, PostgreSQL 17 container, `psql` 18.4). App: `next dev` on `localhost:3000` with a git-ignored `.env.local` pointing only at `http://127.0.0.1:55321`. |
| Data | Synthetic fixtures only (Example Orchard LLC, Sample Harbor Inc, `.invalid` emails), plus three extra fictional profiles. No hosted, Preview, or production services; no real client data; no email. |
| Verdict | **PASS** for the in-scope UI → API → database → audit → reload flows, with the conditions and blockers listed below. |

## Commands and results

| # | Command (repository root) | Result |
| --- | --- | --- |
| 1 | `bash tools/collections-local/reset.sh --local` | PASS, exit 0. The first run took 5m39s (image pull). It applies all 8 Billing/Collections migrations through `20261011100000` and inserts the fixtures. The `NOTICE ... does not exist, skipping` lines come from `drop trigger if exists` on a fresh database. |
| 2 | `bash tools/collections-local/test.sh --local` | PASS, exit 0: `collections_phase1_security_and_audit.sql`, `collections_phase1_audit_actor.sql`, `collections_phase2_stage_regressions.sql`. |
| 3 | `psql postgresql://postgres:postgres@127.0.0.1:55322/postgres -f tools/collections-local/ui-overlay.sql` | PASS. Local-only overlay; see mismatch H1. |
| 4 | `node tools/collections-local/create-test-users.mjs` | PASS. Five local Auth users whose ids match the profiles (Owner, Admin, Collections staff, Billing staff, unassigned staff). Random passwords go to `.env.local` only. |
| 5 | `bash tools/collections-local/test.sh --local` (after the overlay) | PASS. The overlay does not affect the SQL suites. |
| 6 | `npm run dev`, then `node tools/collections-local/validate-phase2.mjs` | **PASS 48/48** from a clean reset (log excerpt below). |
| 7 | Browser pass (built-in browser, real login page, real routes) | PASS; see the flows table. |
| 8 | `npx tsc --noEmit` / ESLint on the UI and tools / `npm run build` | PASS / PASS / PASS (`/billing`, `/collections`). |
| 9 | `node tests/billing-ui-data.test.mjs` / `node tests/billing-ui-render.test.mjs` | PASS 42 / PASS 50 |
| 10 | Collections, access, support suites (`collections-phase1-review`, `collections-phase-2-backend-contract`, `collections-phase1-contract`, `regression-access-policy`, `collections-route-access`, `npm run test:support`) | PASS |
| 11 | `npm run lint` (full repo, local `dev-mock/` excluded) | 583 problems, identical to `3bec72a`; none in changed files. |
| 12 | Legacy suites `client-card-iss-008-009-011`, `client-slideover-renditions`, `contact-profile-actions.contract`, `support-resend-delivery` | FAIL. They fail identically on `origin/main`; unrelated. |

## Flows validated (UI → API → database → audit → reload)

| Flow | Evidence |
| --- | --- |
| Receivables | The UI shows $205.00 open, aging 1–30 $80.00 and 31–60 $125.00, and priority 162.50 (125 × 1.3). The API equals `get_billing_invoice_balances(collections_firm_today())`: `LOCAL-001=125.00@39`, `LOCAL-002=80.00@14`. Worklist, Billing receivables, and the database all use firm date `2026-10-10`. |
| Rules | `GET /api/collections/rules` returns stage, label, days_past_due, automatic, and enabled only. The UI ladder line and stage labels use it. |
| Reminder catch-up | With no history, LOCAL-002 (14 days) proposes **2 · Professional**, skipping 1, and LOCAL-001 (39 days) proposes **3 · Firm** without skipping the stage 4 gate. A UI reminder without a stage is stored with `stage = 2` and actor Owner, with an audit row. After reload the UI shows **Next: 3 · Firm at 15 days**. A forward-dated preview (+2 days) proposes stage 3. |
| Approvals | Staff request an escalation; the worklist shows `awaiting_approval` (stage 4, `next_stage` null) and the UI shows "Awaiting Owner/Admin approval". Staff approval returns 403. The Owner approves through the UI; a second approval returns 409 `APPROVAL_CONFLICT`. After reload LOCAL-001 shows **5 · Formal notice**. |
| Notice sent after a later hold | The Owner requests and approves the formal notice, then places an invoice hold on LOCAL-001. While the hold is active, "Record notice sent" is offered. Without a note: 422. With a note: 201, stored as `formal_notice_sent` with `detail.approval_event_id` and the note. A repeat returns 409 `EVENT_CONFLICT`. Staff get 403. The hold still blocks new escalation requests (409). |
| Holds | The hold insert and its `hold_placed` event are audited with the Owner. Release is audited with the Owner as releaser. A second release returns 409 `HOLD_NOT_ACTIVE`. Responses carry `invoice_number`. |
| Billing → Collections | Payment of $30.00 (ACH) recorded and allocated to LOCAL-002 through the Billing UI. Billing shows a $50.00 balance; after reload Collections shows $175.00 open and 1–30 $50.00. |
| Preview | Owner/Admin only. `automation_enabled=false`, `delivery_mode=disabled`, every action has `delivery_performed=false`, and `collection_delivery_attempts` stayed at 0 throughout. |
| Access | Owner and Admin have full access. Collections staff can read and log, but cannot hold, approve, record a sent notice, preview, or write Billing. Billing staff can read but cannot log events or approve. Unassigned staff get 403 on all Billing/Collections routes and are redirected away from `/collections`. Anonymous requests get 401. In the UI, staff see Owner/Admin notes in place of those controls, and the sidebar matches each role. |

UI audit evidence from the browser pass (`audit_log` rows 5–12):

1. reminder_logged — Owner
2. escalation_requested — Staff
3. escalated — Owner
4. formal_notice_requested — Owner
5. formal_notice_approved — Owner
6. collection_holds insert — Owner
7. hold_placed — Owner
8. formal_notice_sent — Owner

## Mismatches found

| ID | Area | Finding | Status |
| --- | --- | --- | --- |
| H1 | Harness (producer) | The `profiles` subset lacks `location` and `allow_edit_client_data`, which `lib/access-server.ts:34` selects, and `email_2fa_enabled`, which the 2FA check reads. Every signed-in request returned 401 (`ERROR: column "location" does not exist`). | Worked around with `tools/collections-local/ui-overlay.sql` (local only). The producer should fold it into the bootstrap. |
| H2 | Harness (producer) | No local Auth users for the fixture profiles. | `tools/collections-local/create-test-users.mjs` (refuses non-local URLs). |
| H3 | Harness (info) | Sign-in lands on `/time`. Its APIs (`/api/time-entries`, `/api/profile-directory`) return 500 locally because Operations tables are not in the subset. Billing and Collections are unaffected. | Accepted harness limit. |
| T1 | Types (producer) | `lib/collections-api.ts` has no `awaiting_approval` on `CollectionsInvoice`. | UI types it locally; the producer should add it to the shared type. |
| A1 | API (low) | The worklist does not expose the completed stage, so the UI derives the upcoming step from rules thresholds. That is accurate for stage-less reminders, but not if an API caller logs an explicit higher stage early. | Request: return `completed_stage` or `upcoming_stage` in the stage context. |
| A2 | API (low) | The firm timezone is not exposed, so the request date in "Awaiting approval" and history times show UTC (for example 2026-10-11 while the firm date is 2026-10-10). | Request: expose the timezone (rules or a settings subset), or return firm-local timestamps. |

## UI changes on the validation branch

- `4c28fb9` aligns the UI with the integration contract:
  - "Record notice sent" is allowed during a later hold;
  - "Awaiting Owner/Admin approval" is shown;
  - stage labels and the ladder line come from the rules endpoint;
  - the server's `invoice_number` is used;
  - `EVENT_CONFLICT` has a plain headline.
- The final commit fixes the two bugs found in the browser pass:
  - **UI-A**: between ladder steps, the next-step cell said "Ladder complete"; it now says "Next: 3 · Firm at 15 days";
  - **UI-B**: history now uses the configured stage labels.

  It also adds the local harness tools and this handoff.

## Remaining blockers before release

1. Producer review of H1, H2, and T1. Fold the overlay and test-user step into the shared harness, or confirm the current approach.
2. Hosted migration state is still unverified; `20261010140000` and `20261011100000` are local only.
3. COL-DEP-10: the owner rotates the exposed shared Supabase Auth password.
4. COL-DEP-12: the owner reviews the credential-bearing historical migration (not inspected here).
5. Joint review of this branch, then the merge order: integration backend first, then this UI. Nothing goes to `main` until all phases are approved.
