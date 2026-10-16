# Handoff: Collections status, Engineer A (2026-10-17)

| Field | Value |
| --- | --- |
| Author | Engineer A |
| Environment | Local disposable Supabase (`tools/collections-local`) with synthetic fixtures only; app on `localhost:3001`. No hosted project, real client data, provider calls, or email. Automation off, delivery `disabled`, 0 delivery attempts throughout. |
| Branches touched | `codex/collections-phase3-ui` → `9a04d7e`; this handoff on `codex/collections-engineer-a-status` (from `a4a1013`). Nothing merged to `main`. |

## 1. Phase 2 validation on the exact commits

Each run started from a clean `reset.sh --local` and fresh `create-test-users.mjs`.

The API/DB/audit suite is `tools/collections-local/validate-phase2.mjs` from `dd3472f`, pointed at the local app. `8ba6897` does not contain the script or the Billing/Collections pages.

### Backend `8ba6897` (`codex/collections-phase2-integration`), checked out detached

| Check | Command | Result |
| --- | --- | --- |
| Reset | `bash tools/collections-local/reset.sh --local` | PASS (exit 0, 53 s) |
| SQL suites | `bash tools/collections-local/test.sh --local` | PASS: harness schema, Phase 1 security/audit, audit actor, Phase 2 stage regressions, Phase 2 configuration |
| Harness | psql | H4 `contacts.updated_at` present; H5 6/6 client columns; H6 fixture ages `LOCAL-001=40`, `LOCAL-002=15` |
| Delivery off | psql | `automation_enabled=false`, `delivery_mode=disabled`, 0 attempts before and after |
| API/DB/audit | `PSQL=psql node validate-phase2.mjs` (app at `8ba6897`) | **68/68 PASS** |
| S1 access matrix | S1 script (anon, unassigned, Billing, Collections staff, Owner, Admin, Clients-assigned staff; edit boundary; module removal; anonymous writes) | **12/12 PASS** |
| Browser: login form | Owner signs in | Lands on **`/time`**. Expected on this commit: the identity-loading fix (`f7a36a1`) is on the design branch, not here. |
| Browser: Contacts | `/contacts` | PASS (3 contacts, no error) |
| Browser: Collections | `/collections` | Not on this commit (404); the UI lives on `dd3472f` and the design branch |

### Integration line `dev` at `727ca6a`

This is main + `8ba6897` → `dd3472f` → `codex/collections-phase2-demo-design` `19a0428`, and it contains `8ba6897`.

| Check | Result |
| --- | --- |
| Reset, 5 SQL suites | PASS |
| API/DB/audit | **68/68 PASS** |
| S1 matrix | **12/12 PASS** |
| `npx tsc --noEmit` | PASS |
| UI data / render | 42 / 60 PASS |
| Contract and access suites | `collections-phase-2-backend-contract`, `collections-phase1-review`, `collections-phase1-contract`, `contacts-api.contract` (2/2), `contacts-route-access`, `collections-route-access`, `regression-access-policy`, `npm run test:support` (18 + 13): all PASS |
| `npm run build` | PASS |
| Browser, Owner via login form | Lands on Clients. Collections shows AR Insights, Pipeline, and Setup & rules with 6 insight cards and 2 accounts; firm date 2026-10-16. |
| Browser, Collections staff via login form | Lands on `/collections`. No rules editor and no preview. `/api/contacts` returns 403 and `PATCH /api/collections/rules` returns 403. |

**Phase 2 result: PASS** on `8ba6897` (backend scope) and on `dev` (full stack).

**Phase 2 next:**
1. Joint Engineer A/B review of `dev`.
2. Project-owner approval for `dev` → `main`.
3. Hosted migrations at release.

## 2. Phase 3

### Review of `8df77f8` against the contract at `a4a1013`

**Approved, with one correction (now made).**

| Item | Verdict |
| --- | --- |
| Run test now: Owner/Admin, shown only when `test_ready`, confirmation, no body, refreshes status and history | Matches contract item 3 |
| Shared wire types in `lib/collections-api.ts`; UI keeps only wording and helpers | Matches |
| Pause: `POST /api/collections/automation/pause` with no body, off only, returns the delivery-status shape, no unpause in the UI | Matches item 10 |
| Retry sent a `{}` body | **Correction:** the contract says retry takes no body. Fixed in `9a04d7e`, with the test updated to assert no body. |
| `test-run` response typed `unknown` | Note: the contract does not pin the response; the UI shows a generic "finished" message. Please pin it (run id plus counts). |
| Run test now while paused | Note: the UI relies on `test_ready`. Please confirm the server reports `AUTOMATION_PAUSED` in `missing` (making `test_ready` false), or define whether a paused system may run a manual test. |

### Integrated checks: `tools/collections-local/validate-phase3.mjs` (new in `9a04d7e`)

The script runs against real routes and records PASS, FAIL, or BLOCKED. BLOCKED means the route or field is not installed yet (404 without a code). The script never creates a delivery attempt.

Command: `APP_URL=http://localhost:3001 PSQL=psql node tools/collections-local/validate-phase3.mjs` on `9a04d7e`.

**Result: 5 PASS, 0 FAIL, 20 BLOCKED.**

| ID | Result | Evidence |
| --- | --- | --- |
| DB1 delivery off by default | PASS | `false disabled` |
| DB2 duplicate prevention | PASS | `UNIQUE (invoice_id, stage)` and `UNIQUE (idempotency_key)` |
| DB3 table locked down | PASS | RLS on; no `anon`/`authenticated` grants |
| DB4 `accepted` vocabulary | BLOCKED | Status check still allows `sent`, and the column is `sent_at`; needs the forward-only migration (contract item 1) |
| DB5 / END zero attempts | PASS | 0 before and after |
| Routes present | BLOCKED ×5 | `delivery-status`, `deliveries`, `deliveries/{id}/retry`, `automation/pause`, and `automation/test-run` all return 404 without a code |
| Access matrix, status shape and secrets, history paging/filters, retry, pause audit and off-only, test-run refusal | BLOCKED | Waiting on the routes |
| `last_delivery` on worklist; `delivery_attempt` on preview | BLOCKED | Fields not returned yet |
| Synthetic-data marker (item 9) | BLOCKED | Not implemented yet |

UI evidence on `9a04d7e`:
- `tsc` and ESLint pass.
- UI data 46/46 and render 64/64 pass.
- In the browser, with no backend, every Phase 3 panel shows "not available on this server yet".

**Backend routes and integrated checks are coordinated, not implemented, by Engineer A.** They are Engineer B's track (routes, migration, worker, provider adapter, synthetic marker). When they land, rerun the script and do a browser pass: Owner, Admin, Collections/Billing/unassigned staff, and signed out.

## 3. Phase 4 review (`docs/contracts/collections-phase-4-ar-pdf-intake.md` on `a4a1013`)

The draft is sound as a preparation document. Its safe default is right: PDFs are comparison-only, are never written to Billing, and never drive reminders.

It is **not frozen**, and nothing will be built until the project owner approves the decisions below.

| # | Decision | In plain words | Recommended default |
| --- | --- | --- | --- |
| 1 | Authority by field | When the PDF and TAP Hub disagree on a customer, invoice, balance, due date, credit, or aging, which one is right? | TAP Hub Billing is right for everything; the PDF is a dated report used only to spot differences. Revisit per field later if needed. |
| 2 | Conflict policy | What happens to Collections when they disagree, and who decides? | If the PDF shows **less** owed than Billing (the client may have paid in QuickBooks), pause reminders for that invoice until an Owner/Admin resolves it. If it shows **more**, flag it only. Owner/Admin resolves by correcting Billing by hand or dismissing the difference. |
| 3 | Invoice matching | How a PDF row is matched to a TAP Hub client and invoice. | Exact invoice number plus client code. Customer-name aliases live in an Owner/Admin-managed list. Anything else goes to a review queue; never guess. |
| 4 | Summary vs detail | Must both report types be uploaded together, and what if their totals disagree? | Require the detail report. The summary is optional and used as a cross-check; if the totals disagree, the whole batch stays blocked until reviewed. |
| 5 | Report date and aging | Which date the report is "as of", and whether to trust QuickBooks' aging. | Use the report's printed as-of date. Recompute aging from due dates in the firm timezone (America/Chicago), and show QuickBooks' aging beside it for comparison. |
| 6 | Re-imports | What happens when the same or a corrected report is uploaded again. | Same file (same hash): nothing happens. A new file for the same as-of date supersedes the old batch, which is kept and marked superseded, never overwritten. |
| 7 | Roles | Who can upload, fix parsed values, match, and approve. | Owner/Admin upload, correct, match, and approve. Billing staff can view comparisons read-only. Collections staff see only the "doesn't match the report" flag. |
| 8 | Retention and privacy | How long PDFs and extracted data are kept, where, and who can download them. | Private encrypted storage, downloads Owner/Admin only, every download audited. Keep as long as the firm's financial-record policy requires (suggest 7 years; please confirm). |
| 9 | Credits and zero/negative balances | How unapplied cash, credits, voids, and zero balances are handled. | Import credits and unapplied cash as separate credit rows, never netted into an invoice. Ignore zero balances and voids for comparison, but keep them in the stored batch. |
| 10 | What "accepted" means | If a batch is approved, does it update TAP Hub or stay a read-only snapshot? | Read-only snapshot. Approving a batch never writes invoices, payments, or allocations; any ledger change stays a manual Billing action. A ledger-write path would need its own contract. |

The sample A/R PDFs stay out of Git, fixtures, screenshots, external services, and shared environments; development uses synthetic PDFs only. Phase 4 must not enable any Phase 3 delivery.

## Remaining owner decisions and blockers

1. Phase 2: project-owner approval for `dev` → `main` after the joint review; hosted migration plan at release.
2. Phase 3: Engineer B routes, the `accepted` migration, the delivery fields, the synthetic marker, and the pinned `test-run` response. Then the Engineer A integrated rerun.
3. Phase 4: the ten decisions above. The contract is not frozen.
4. **Deferred owner security actions (still open):**
   - COL-DEP-10: rotate the exposed shared Supabase Auth password and review sessions.
   - COL-DEP-12: review the historical credential-bearing migration.
