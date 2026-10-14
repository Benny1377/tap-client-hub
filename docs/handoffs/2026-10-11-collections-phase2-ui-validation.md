# Handoff: Collections Phase 2 integrated UI/API/database validation (Engineer A)

| Field | Value |
| --- | --- |
| Date | 2026-10-11 (firm date 2026-10-10, America/Chicago) |
| Backend under original validation | `codex/collections-phase2-integration` at `3bec72a` (the pass recorded below predates producer follow-ups) |
| Original validation branch | `codex/collections-phase2-ui-validation` at `3013b12`: `3bec72a` plus the Phase 1/2 UI, browser fixes, and local validation tools |
| Environment | Disposable local Supabase from `tools/collections-local` (Docker Desktop 4.94.0, Supabase CLI 2.120.0, PostgreSQL 17 container, `psql` 18.4). App: `next dev` on `localhost:3000` with a git-ignored `.env.local` pointing only at `http://127.0.0.1:55321`. |
| Data | Synthetic fixtures only (Example Orchard LLC, Sample Harbor Inc, `.invalid` emails), plus three extra fictional profiles. No hosted, Preview, or production services; no real client data; no email. |
| Original verdict | **PASS** for the in-scope UI → API → database → audit → reload flows on the older backend, with the follow-up rerun still required below. |

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
| H1 | Harness (producer) | The original `profiles` subset lacked fields used by identity/2FA checks. | Addressed in follow-up bootstrap; no overlay is needed on the updated branch. |
| H2 | Harness (producer) | No local Auth users for the fixture profiles. | `tools/collections-local/create-test-users.mjs` (refuses non-local URLs). |
| H3 | Harness (info) | Sign-in lands on `/time`. Its APIs (`/api/time-entries`, `/api/profile-directory`) return 500 locally because Operations tables are not in the subset. Billing and Collections are unaffected. | Accepted harness limit. |
| T1 | Types (producer) | The original shared invoice type omitted `awaiting_approval`. | Addressed in shared types along with server progression fields. |
| A1 | API (low) | The original worklist did not expose server-computed progression. | Addressed by migration `20261011110000`; the UI consumes server `upcoming_stage`. |
| A2 | API (low) | The original rules response omitted the firm timezone. | Addressed by rules API and firm-timezone UI formatters. |

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

## Producer follow-up after this validation run

The PASS above was run against backend `3bec72a`. After it, producer changes were prepared locally in separate backend and UI worktrees; they are not yet committed or pushed and have not had a new integrated browser pass.

| ID | Follow-up | Local implementation status | Required confirmation |
| --- | --- | --- | --- |
| H1 | Add required profile fields and seed all five synthetic roles. | Implemented on the backend branch through `53324a7`; local harness schema test covers fields and `.invalid` profiles. | Included in integrated clean-reset rerun. |
| H2 | Provision local Auth users with random passwords stored only in ignored `.env.local`. | `tools/collections-local/create-test-users.mjs` is hard-pinned to `127.0.0.1:55321`. | Aanan: run on his machine and validate all five role logins. |
| T1 | Share approval and progression types. | Added in shared `lib/collections-api.ts`. | Typecheck passes on integrated branch. |
| A1 | Return server-derived completed/upcoming stage. | Forward-only migration `20261011110000_collections_stage_context_and_timezone.sql`; the UI consumes `upcoming_stage`. | SQL regression passes locally; integrated browser rerun needed for explicitly early higher reminder stage. |
| A2 | Return firm timezone and display approval/history times in it. | Rules API and date formatters consume `firm_timezone`. | Unit/render tests pass; integrated browser rerun needed around midnight UTC. |
| O1 | Make the demo's dynamic ladder and guardrails real, while preserving Owner/Admin approval and deferring delivery integration. | Owner/Admin-only `PATCH /api/collections/rules`, audited migration `20261011120000`, and a UI rules editor now cover thresholds, copy, enabled/automatic settings, balance/escalation limits, schedule, weekdays, and timezone. Stages 4–5 cannot be automatic; high balances and manually held early reminders surface as Owner/Admin review. Email delivery remains disabled; sender/test recipient are not configured. | Local SQL/API-contract/type/lint/build checks pass; Engineer A should exercise save/reload, direct-threshold preview, and approval-only stages in integrated browser rerun. |
| O2 | Default to primary client contact; pause on ambiguity; remember an explicit selection. | Client contact selection transaction clears competing primary flags and writes actor-attributed audit rows; existing worklist remains fail-closed until a unique primary email exists. | Local SQL regression passes; Engineer A should verify contact selection and blocked preview in browser. |

Current follow-up verification: UI data/render suites (42 and 52 checks), backend contract test, typecheck, targeted ESLint, and production build pass on the merged local UI worktree. Backend SQL suites (including configuration/contact audit), contract test, typecheck, targeted ESLint, and production build pass through backend `9dec973`; the final preview-specific route follow-up at `53324a7` passes its backend contract test, typecheck, and targeted lint. These checks used the local synthetic Supabase only. The full login/browser result still refers to `3bec72a`; Engineer A must rerun on the newly pushed integration and UI branches before sign-off.

## Integrated rerun on backend `53324a7` (Engineer A)

Branch `codex/collections-phase2-ui-validation` at `64f1c1e` (contains integration `53324a7`), plus the two UI fixes below. Firm date 2026-10-11. Same local-only environment and synthetic data; automation off, delivery disabled, no hosted services.

**Verdict: PASS.** The new rules, progression, timezone, and contact-selection contract works end to end. Two harness gaps (H4, H5) and one misleading preview warning (A3) remain for the producer, and one pre-existing security gap (S1) on `main` is outside Phase 2.

| # | Command (repository root) | Result |
| --- | --- | --- |
| R1 | `bash tools/collections-local/reset.sh --local` | PASS, exit 0 (73 s). Migrations through `20261011120000`. |
| R2 | `bash tools/collections-local/test.sh --local` | PASS, exit 0: harness schema, Phase 1 security/audit, audit actor, Phase 2 stage regressions, Phase 2 configuration. |
| R3 | `node tools/collections-local/create-test-users.mjs` | PASS. All five roles ready; no overlay needed (H1 resolved). |
| R4 | `psql … -c "alter table tap_hub_project.contacts add column if not exists updated_at timestamptz not null default now(); notify pgrst, 'reload schema';"` | Local-only workaround for H4; not committed. |
| R5 | `npm run dev`, then `PSQL=psql node tools/collections-local/validate-phase2.mjs` | **PASS 68/68** from a clean reset (48 original checks updated to the new contract, plus 20 new ones below). |
| R6 | Browser pass (Owner, Collections staff) | PASS, with UI-C and UI-D found and fixed. |
| R7 | `npx tsc --noEmit` / targeted ESLint / `npm run build` | PASS / PASS / PASS |
| R8 | `node tests/billing-ui-data.test.mjs` / `node tests/billing-ui-render.test.mjs` | PASS 42 / PASS 53 |
| R9 | `collections-phase-2-backend-contract`, `collections-phase1-review`, `collections-phase1-contract`, `npm run test:support`; with `node --experimental-strip-types`: `collections-route-access`, `contacts-route-access`, `regression-access-policy` | PASS |
| R10 | Full ESLint | 585 problems: 3 in the local-only `dev-mock/`, so 582 in the repo (baseline 583); none in changed files. |

New checks in `validate-phase2.mjs`:

| ID | Check | Evidence |
| --- | --- | --- |
| R1 | Rules response | Rules carry `subject_template` and `body_template`; `firm_timezone` equals `collection_settings.timezone`; settings hold only the five guardrails, with no sender or test-recipient fields. |
| PG1 | Server progression | LOCAL-002 at 15 days: `completed_stage` 0 → 3 after the catch-up reminder, `upcoming_stage` 4, `next_stage` null. |
| PV2 | Forward preview | Jumps to the day the upcoming stage falls due (as of 2026-10-17, 21 days). Stage 4 shows `owner_escalation_review` / `approval_required` and nothing is delivered. |
| CT1–CT4 | Contact selection | Two primary contacts suppress the reminder (`contact_review_required`). Collections staff get 403 when choosing. The Owner's choice returns 200 and leaves exactly one primary, with audit rows by the Owner for both contacts. The reminder is then `preview_only` again. |
| ES0–ES3 | Early higher stage | LOCAL-003 is created, given a line, and issued through the Billing API ($40.00 at 2 days, next 1). The Owner logs explicit stage 3 early, which gives `completed_stage` 3, `upcoming_stage` 4, `next_stage` null. When stage 3 would normally fall due, the preview proposes nothing. |
| CF1–CF6 | Rules configuration | Automatic stage 4 → 422 `INVALID_CONFIGURATION`. Invalid timezone → 422; unsupported sender field → 422. An Admin label, guardrail, and timezone edit → 200, persisted, with Admin audit rows on `collection_ladder_rules` and `collection_settings`. Staff see the new label and timezone. Direct threshold 50 proposes stage 4 Owner/Admin review. Restoring the original values round-trips exactly. |
| PV3 | No delivery | `collection_delivery_attempts` stays 0; `automation_enabled` stays false with `delivery_mode` disabled. |
| AC3 | Access matrix | `PATCH /api/collections/rules`: Collections, Billing, and unassigned staff get 403; anonymous gets 401. |

Browser evidence:

- **Rules editor:**
  - Owner sees "Owner/Admin · Configure Collections rules"; Collections staff see no editor and no preview, and their PATCH returns 403.
  - A stage 2 label edit saves and the ladder line updates.
  - An invalid timezone shows "Configuration values are invalid" and the editor stays open.
- **Next step:**
  - LOCAL-003 (2 days, stage 3 logged early) and LOCAL-002 (15 days) show "Next: 4 · Owner escalation at 21 days".
  - LOCAL-001 (stage 5 done) shows "Ladder complete — follow up manually".
- **Firm timezone:** with the timezone temporarily set to `Pacific/Kiritimati` (UTC+14), the firm date, days past due, and history all moved to 10/12 together (history shows "GMT+14"); restored to `America/Chicago` afterward.
- **Contact review:**
  - The worklist row shows "Contact needs review" while two primaries exist.
  - The preview for 2026-10-17 shows LOCAL-002 "Needs Owner/Admin review" with "Nothing was sent", but the note reads "No client email on file" (A3).
- **Network:** every Billing and Collections request returned 200 or the expected 403/422. The only 500s were from `/api/contacts` (H5) and the Timesheet APIs (H3).

UI fixes from this rerun:

- **UI-C**: hold "placed" and "released" dates used the UTC date (`slice(0, 10)`). They now use `formatFirmDate` with the firm timezone. Browser check: shown as 10/12 under UTC+14 and 10/11 under Chicago. A new render test covers a late-evening Chicago hold.
- **UI-D**: after saving, the rules editor was remounted by `key={JSON.stringify(ruleSettings)}`, which collapsed it and dropped the "Rules saved" message. The editor now re-syncs from new server values without remounting. Browser check: it stays open and shows "Rules saved. Email delivery remains disabled."

New findings:

| ID | Area | Finding | Proposed fix |
| --- | --- | --- | --- |
| H4 | Harness (producer) | `contacts` has no `updated_at`. `PATCH /api/contacts` always writes it, so choosing a primary contact returns 500 locally. With the column added (R4), the route returns 200 and the audit is correct. | Add `updated_at timestamptz not null default now()` to the bootstrap `contacts` table. |
| H5 | Harness (producer) | `clients` lacks `client_code`, `group_name`, and address columns that `GET /api/contacts` selects, so the Contacts page shows "Unable to load contacts" locally. The browser path for choosing a contact cannot be exercised; the API path was validated (CT3). | Add the selected `clients` columns to the bootstrap. |
| H6 | Harness (low) | The seed uses the database `current_date` (UTC) while the app uses the firm date, so fixture ages shift by one day depending on the time of day (LOCAL-002 is 14 or 15 days). The validation script no longer depends on exact ages. | Seed due dates from `tap_hub_project.collections_firm_today()`. |
| A3 | API (low) | For stage 4 and 5 actions, an ambiguous primary contact is reported as `email_contact_missing`, so the UI says "No client email on file" even when both contacts have emails. | Return `contact_review_required` as the stage 4 and 5 warning when the contact is ambiguous. The UI now labels it "Needs one primary contact with an email". |
| A4 | API (info) | Money in `settings` comes back as plain numeric strings (`"50"`, `"60"`) rather than the two-decimal format used elsewhere (`"125.00"`). | Format as fixed two decimals, or document it. |
| S1 | Security (pre-existing on `main`, outside Phase 2) | `GET /api/contacts` has no access check, and `proxy.ts` treats `/api/*` as public. An anonymous request reaches the service-role query; locally it returns 500 only because of H5, while other routes return 401. With the full schema it would return all contacts and client addresses. | Owner/producer decision; fix on its own branch with a regression test. |

## Remaining blockers before release

1. Producer review of H4 and H5, and preferably H6 and A3.
2. S1 is decided by the owner/producer, independent of Phase 2 but before any release.
3. Hosted migration application is intentionally deferred until after local integrated testing and release approval; migrations `20261010140000`, `20261011100000`, `20261011110000`, and `20261011120000` are confirmed only in the local harness.
4. COL-DEP-10: the owner rotates the exposed shared Supabase Auth password.
5. COL-DEP-12: the owner reviews the credential-bearing historical migration (not inspected here).
6. Joint review of this branch, then the merge order: integration backend first, then this UI. Nothing goes to `main` until all phases are approved.
