# Billing Phase 2: Engineer A validation of `6d32fb7`

| Field | Value |
| --- | --- |
| Date | 2026-11-05 |
| From | Engineer A (Billing UI / workbench) |
| To | Engineer B, project owner |
| Reviews | `codex/billing-phase2-prep` at `6d32fb7`, migration `20261105100000_billing_phase2_core.sql`, against the Phase 2 contract at `86f65ef` |
| Evidence branch | `codex/billing-phase2-matrix` at `304494e` (= `6d32fb7` + Phase 1 validation merge `8f3f952` + the matrix and fixture repairs below) |
| Scope | Local synthetic harness only (app on 3000, API 55321, database 55322). No sandbox, Preview, hosted or Production system was touched. No credentials appear in this record |
| Outcome | **Phase 2 backend is not ready to be called complete.** 79 of 87 authenticated checks pass; 8 fail and map to the findings in section 3 |

## 1. What was run

All against a clean `reset.sh --local` (including `20261105100000_billing_phase2_core.sql`) and `create-test-users.mjs`, with `npm run dev`.

| Check | Result |
| --- | --- |
| New `tools/collections-local/verify-billing-phase2-routes.mjs`, one run per reset | **79/87 passed, 8 failed**, 2 informational lines. Full output kept with the run; failing checks listed in section 3 |
| `test.sh --local` (six SQL checks) | PASS, but only after fixture repairs (section 4); on `6d32fb7` as pushed, `reset.sh` itself fails at the seed |
| `supabase/tests/billing_phase2_core.sql` | PASS on a clean reset. Not wired into `test.sh`, and not repeatable on a database that already holds a source map for the service it picks (section 4) |
| `validate-billing-phase1-invariants.sql` | PASS after repair |
| `test-billing-allocation-concurrency.mjs` | PASS after repair (it failed on `6d32fb7`) |
| Tej's unit tests `billing-phase2-operations` (6), `billing-phase2-serialization` (5) | 11/11 PASS (run with `--experimental-strip-types`) |
| `tsc --noEmit`, `npm run build` | PASS |
| ESLint on `app/api/billing`, `lib/billing-*` | 1 error, in `payments/[id]/route.ts` (`any`), a file Phase 2 did not change |
| Committed Phase 1 matrix (`verify-billing-phase1-routes.mjs`) on this branch | Cannot run: draft creation with a number and dates is now 422 by design. It needs updating to the Phase 2 create flow; that is Engineer A's follow-up |

### What the Phase 2 matrix covers

Authenticated HTTP with session cookies as Owner, Admin, Billing staff, Collections-only staff and unassigned staff (a signed-out session for 401). Operations facts (synthetic services, work period, period count) are inserted through psql because no Operations API exists; no Billing row is inserted directly.

| Group | Checks | Covers |
| --- | --- | --- |
| A | 11 | 401 for signed-out; 403 for Collections-only and unassigned on every read and write; `/permissions` for Owner, Admin (14 actions) and Billing staff (the 8 defaults); Billing staff cannot manage pricing, terms, remittance or policy |
| B | 17 | Rate cards, entries, overrides, bundles, terms and remittance mutations; decimal strings; overlap 409; cursor paging, `INVALID_CURSOR`, limit bounds; reason rules |
| C | 19 | Maps (valid, invalid, overlap); scope and window errors; schedule projection persists nothing; generation (priced, unpriced, idempotent re-run); candidate list shape and paging; dismiss, reopen, reprice with reasons and audit ids; the work-period and count adapters |
| D | 8 | Manual confirmation: map required, validation, create, replay, conflicting replay, duplicate, role access, audit |
| E | 22 | Manual draft, candidate-built draft, claim conflicts, line immutability (route and database), removal and draft deletion returning candidates, issue (number, firm date, Net 15, remittance snapshot, candidate state), delete of an issued invoice, void with and without allocation, role limits, void return behaviour, terms override and legacy adapter response, number sequence |
| F | 2 | Bundle: components drafted together, one package line, component amounts |
| G | 5 | Policy editor: refusals, delegation changing real access, restore, audit |
| H | 3 | Audit actor, anon key denied on six Phase 2 tables, no reused numbers |

## 2. What passed that matters

- Authorization, 403 for Collections-only and unassigned (no redacted bodies) and 401 for signed-out, on every Phase 2 path tested, including `GET /permissions`.
- Defaults: Billing staff resolve exactly the 8 contract actions. Owner and Admin resolve all 14. `policy.manage`, `invoices.void` and `payments.reverse` cannot be delegated (422 and 403).
- Money is a decimal string in every new response checked. Candidate and pricing cursors work. Overlap, window, reason and cursor errors use the contract codes.
- Drafts have null number and dates. Issue assigns `TAP-YYYY-####` in sequence, the firm date, Net 15 (Net 30 with a client override) and a remittance snapshot, and moves candidates to `invoiced`. Void and draft or line removal return candidates in one call, with `returnedCandidateIds` and `refresh`. The database, not only the route, rejects editing a candidate-linked line. The anon key reads none of the Phase 2 tables.
- Audit rows carry the real actor for rate cards, candidates, invoices, manual confirmations and policy changes.

## 3. Findings

Severity is Engineer A's reading. Each failing matrix check is named.

| # | Severity | Finding | Evidence | Suggested fix |
| --- | --- | --- | --- | --- |
| 1 | High | **The work-period and count adapters silently create nothing.** The query filters `period >= 'YYYYMM'` and `normalizeOperationsPeriod` accepts only six digits. The local fixture and the checked-in schema reference store text `YYYY-MM` (the fixture enforces it with a check constraint), and the shared sandbox declares both columns as text. With a done `2026-10` work period and a count of 3 against a threshold of 2, generation returns `created: 0, skipped: 0`. A mismatch is invisible: no error and no skip reason. The contract also holds all adapter work until the Operations owner supplies a schema export | C18, C19 | Get the export first. Then normalize both `YYYY-MM` and `YYYYMM` in code, filter on the normalized value rather than a string range, and report unreadable periods as `source_incomplete` |
| 2 | Medium | **Manual confirmation can double-bill.** A second confirmation for the same service and date with a new idempotency key creates a second candidate (201, two candidates). The contract says a confirmation "cannot create a duplicate candidate". A confirmation dated 2031 is also accepted | D6 (fail), D7 (info) | Make identity service plus confirmed date, keep the key only for replay, and decide whether future dates are allowed |
| 3 | Medium | **Bundle responses do not match the contract.** `GET /bundles/{id}` and the list return `billingBundleComponents` instead of `components`; `POST /bundles` returns no `components` at all. Pricing rows also expose `createdBy`, `updatedBy` and `reason` | B13 | Map to `components: [{clientServiceId}]` and drop the audit columns from responses |
| 4 | Medium | **Legacy draft PATCH returns 500.** `PATCH /invoices/{id}` still accepts `invoice_number`, `issue_date` and `due_date`; the draft check then fails and the route answers 500 `INVOICE_UPDATE_FAILED` | E4 | Reject those keys with 422 |
| 5 | Medium | **Malformed ids give 500.** `candidateIds: ["not-a-uuid"]` on `from-candidates` returns 500 `DRAFT_CREATE_FAILED`; a bad id in the path of `rate-cards`, `client-pricing/overrides` or in `clientId` returns 500 `BILLING_READ_FAILED` or `BILLING_WRITE_FAILED` | E5, plus probes | Validate UUIDs and answer 422 (or 404 for a path id); map PostgreSQL error `22P02` |
| 6 | Low | **`reason` is required on `POST /rate-cards` and on rate-entry creation, but the contract examples omit it.** The UI will send one, but the contract and code disagree | B1, B3 | Add `reason` to those two examples, or make it optional |
| 7 | Low | **`auditId` is found by a timestamp query** (app clock against database clock) after a non-transactional read-then-update. Clock skew or a concurrent change to the same candidate could return `null` or another row's id. Passed here (C12, C15). From code reading only | none failed | Perform dismiss, reopen and reprice in an RPC that returns the audit id |
| 8 | Low | **`reprice` also reopens a dismissed candidate**, bypassing the `reopen` rule and error code. From code reading only | not exercised | Restrict `reprice` to `open` and `unpriced`, as the lifecycle table says |
| 9 | Low | **Issue and void RPCs do not check the actor's role in the database**, unlike the policy RPC. The routes do check; the functions are `service_role` only. From code reading only | not exercised | Add the same Owner/Admin check to the void RPC for defence in depth |

Bundle components each carry the full package price as their own `unitAmount` (300.00 and 300.00 for a 300.00 package, F3). That is consistent with the contract but means a screen summing candidates would double count. The UI will count a bundle once through `priceSource`.

## 4. Local harness faults found and repaired on `codex/billing-phase2-matrix`

None of these are product defects, but each blocked evidence.

1. `tools/collections-local/seed.sql` inserted draft invoices with numbers and dates; the Phase 2 check rejects that, so `reset.sh --local` fails on `6d32fb7`. Repaired: draft with nulls, then issue with number and dates.
2. Three SQL tests, the invariants validator and the concurrency test did the same (including the fixtures corrected in `9ab70b5` for Phase 1). Repaired the same way.
3. The local Operations fixture had no `client_services.financials_month` and no `service_role` read grant on `services`, `work_periods` and `period_counts`, so generation and the schedule projection returned 500 locally. Repaired in the fixture migration.
4. `billing_phase2_core.sql` is not in `test.sh`, and it fails on a database that already holds a source map for the client service it picks.

## 5. The two endpoints that extend the frozen contract

### `POST /api/billing/candidates/manual-confirmations`

Body `{idempotencyKey (UUID), clientServiceId, confirmedDate, sourceNote, reason}`. Authorized by `candidates.manage`. Responses: `201` created or `200` replay with `{created, confirmationId, candidate, refresh}`; `409 COMPLETION_SOURCE_MAP_REQUIRED` without a covering manual map; `409 DUPLICATE_RESOURCE` for a reused key with different data; `422` for validation.

- Tested: role access (Billing 201, Collections-only 403), validation, replay, conflicting replay, audit with the Billing actor.
- Gaps: finding 2 (duplicate by new key, future dates). The codes `COMPLETION_SOURCE_MAP_REQUIRED` and `DUPLICATE_RESOURCE` are not in the contract's error table.

### `PATCH /api/billing/permissions/policy`

Body `{policies: [{actionKey, allowedRoles, enabled}], reason}`; response `{policies, refresh: ["permissions"]}`. Owner and Admin only. Delegable roles are `manager`, `staff` and `offshore`.

- Tested: the three fixed actions, owner and admin roles, missing reason and duplicate roles are refused (422); delegating `pricing.manage` gives Billing staff real access, disabling `candidates.manage` removes it; a delegated `pricing.manage` does not let staff edit policy (403); restore returns the defaults; changes are audited with the Owner actor and reason. The database function repeats the Owner/Admin check.
- Open: nothing prevents disabling `billing.view` or `candidates.view` for staff, which would lock Billing staff out of nearly every read. Decide whether that is allowed.

Both endpoints, the policy body shape and every extra error code in the implementation (`DUPLICATE_RESOURCE`, `NOT_FOUND`, `INVALID_INPUT`, `FORBIDDEN`, `BILLING_READ_FAILED`, `BILLING_WRITE_FAILED`, `INVALID_JSON` and others) need to be written into the contract before they are frozen. The UI maps only what the contract lists.

## 6. Not covered

- Hosted behaviour, the shared sandbox and any Vercel Preview.
- Two simultaneous draft claims on one candidate, and concurrent issue sequencing (the SQL test may cover some; the matrix does not).
- Firm-date boundaries around midnight and across the daylight-saving change.
- UI behaviour; no Phase 3 screen is built.

## 7. Position

Engineer A does not accept Phase 2 backend completion yet. Closing it needs findings 1 to 5 resolved (finding 1 gated on the Operations schema export), findings 6 to 9 decided, the extension endpoints and codes written into the contract, and a rerun of `verify-billing-phase2-routes.mjs` on a clean reset that passes in full.
