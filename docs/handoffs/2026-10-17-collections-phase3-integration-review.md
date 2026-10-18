# Collections Phase 3: Engineer A integration review of the backend

Date: 2026-10-17 · Engineer A (UI/consumer) · Local harness only (ports 55320–55324, app on :3001)

Delivery stayed disabled throughout. No provider request, no email, no hosted migration, no merge to `main`.

## What was reviewed

| Item | Commit | Branch |
| --- | --- | --- |
| Engineer B backend | `af2a52e` | `codex/collections-phase3-backend` |
| Engineer A UI (with Engineer B review commit `8df77f8`) | `9a04d7e` → `fe477d8` → `83e2e21` | `codex/collections-phase3-ui` |
| Engineer A proposed backend fixes (for Engineer B review) | `5511876` (base `af2a52e`) | `codex/collections-phase3-backend-fixes` |
| Local integration (not pushed) | `af2a52e` + UI + fixes | `codex/collections-phase3-integration` |

The only merge conflict was `lib/collections-api.ts`: both branches added the same Phase 3 types, identical except for formatting. The UI branch's copy was kept; `last_delivery` is non-optional because the backend always sets it.

## Results on the final integration (`af2a52e` + `83e2e21` + `5511876`)

| Check | Result |
| --- | --- |
| `reset.sh --local` (applies `20261017120000_collections_test_delivery.sql`) | PASS |
| `test.sh --local` (5 SQL suites) | PASS |
| `tsc --noEmit` | PASS |
| UI data / render suites | 46 / 65 PASS |
| Phase 3 backend contract (Engineer B) / proposed fixes (Engineer A) | 5/5 / 3/3 PASS |
| Phase 1, Phase 2 contract, route-access, contacts, support suites | PASS |
| `validate-phase2.mjs` (fresh users) | 68/68 PASS |
| `validate-phase3.mjs` on a fresh reset, signed in as each role | 55 PASS, 0 FAIL, 0 BLOCKED |
| `validate-phase3-worker.sql` (claim/accept/pause functions, each block rolled back) | W1–W12 as expected (below) |
| `POST /api/collections/automation/run` without / with a wrong token | 401 / 401 |
| Database after all runs | 0 attempts, 0 `reminder_logged`, automation off, delivery disabled |

Browser (Owner): Setup shows "Email delivery: Off / Not ready" with all seven missing settings in plain wording; "Run test now" is withheld while not ready; automation shows as off with no switch-on control. Pipeline shows Delivery history with status/invoice filters and the empty state. Browser (Collections staff): no delivery panels render and no delivery route is called.

Worker function checks (rolled back): eligible claim → `sending`, count 1 (W1); message context carries no client email or name (W2); first accept → `accepted` with exactly one `reminder_logged`, replay refused (W3); stage context counts one completed stage (W4); audit rows carry the actor (W4); automation off → `DELIVERY_DISABLED` (W5); non-synthetic → `SYNTHETIC_DATA_REQUIRED` (W6); hold → `ACTIVE_HOLD` (W7); weekend with weekdays-only → `RULE_DISABLED` (W8, see finding 1); primary contact without email → `EMAIL_CONTACT_MISSING` (W9); stage 5 without approval → `APPROVAL_REQUIRED` (W10); out-of-order stage → `ATTEMPT_ALREADY_EXISTS` (W11); no anon/authenticated EXECUTE grants and pause rejects an unknown actor (W12).

Two of Engineer A's own checks were corrected during the run (no backend change): ST2 flagged the `PROVIDER_KEY_MISSING` code as a leaked key, and PV1 reported an empty preview (after the Phase 2 suite consumed every stage) as a missing field.

## Findings for Engineer B

1. **Medium — test run outside the send window creates "turned off" attempts.** `lib/collections-test-run.ts` inserted attempts before the claim; `claim_collection_test_delivery` returns `RULE_DISABLED` outside 09:00–17:00 Chicago or on weekends, and the row is saved as `suppressed` / "This reminder stage is turned off." Proposed fix in `5511876`: check the window before any insert and answer 409 `OUTSIDE_SEND_WINDOW` from `test-run` and `run`.
2. **Medium — a reopened attempt could stay `queued`.** The synthetic and stage 1–3 contact pre-checks ran after a `suppressed` attempt was reopened; on those paths the row stayed `queued` ("Waiting to send", and it blocks a new send in the preview). Proposed fix in `5511876`: pre-checks first; a queued attempt that fails them goes back to `suppressed` with the reason code.
3. **Low — reason codes.** Out-of-order stage returns `ATTEMPT_ALREADY_EXISTS`; a non-issued invoice returns `SYNTHETIC_DATA_REQUIRED`; the in-database window check returns `RULE_DISABLED`. Needs a forward migration or a contract addendum.
4. **Low — run counts and stage 4.** Already-handled attempts were counted as `suppressed` on every run (fixed in `5511876`). Stage 4 email content comes from the editable template; suggest a fixed "Internal Owner-escalation notice — TEST" header.
5. **Low — template text is not HTML-escaped**, only the substituted values. Owner-controlled and test-mailbox-only.
6. **Question — Resend idempotency on retry.** Retries reuse `collections:{invoice}:stage:{n}`; confirm a cached 429/5xx is not replayed within the provider's idempotency window.
7. **Contract — pin the retry response** (202 `{ attempt_id, status: "queued" }`), the test-run counts, and the new `OUTSIDE_SEND_WINDOW` code. Engineer A's types and wording already match (`fe477d8`, `83e2e21`).

## Sign-off

- **Backend/UI integration with delivery disabled: signed off by Engineer A** on the integration above.
- **Provider-backed test sending: not signed off.** Requires Engineer B to accept or replace `5511876`, mock-provider tests (accepted, 429, 5xx, timeout, malformed, concurrent claims), and an owner/operator configuration review before any provider key or test send.

## Re-review 2026-10-18: backend `c9d486f`, contract `2b1fce4`

Engineer B accepted Engineer A's proposed fixes (`5511876`) and added `c9d486f` on `codex/collections-phase3-backend-fixes`. Re-integrated locally on `codex/collections-phase3-integration` (`c9d486f` + UI `6ac9381`/`1c50db1`); the only conflict was the shared type block in `lib/collections-api.ts`, identical apart from formatting.

| Finding | Resolution |
| --- | --- |
| 1 Send window | Accepted from `5511876`; in-database claim/context now return `OUTSIDE_SEND_WINDOW` (W8). |
| 2 Stuck `queued` | Accepted from `5511876`; `c9d486f` also re-suppresses an already-suppressed attempt with the new reason. |
| 3 Reason codes | New codes `STAGE_NOT_DUE` (W11), `INVOICE_NOT_ELIGIBLE`, `OUTSIDE_SEND_WINDOW`, `PROVIDER_PAYLOAD_CHANGED`; pinned with wording in the contract addendum. UI wording added in `6ac9381`. |
| 4 Stage 4 / counts | Fixed subject and first heading `Internal Owner-escalation notice — TEST`; counts fixed in `5511876`. |
| 5 Template escaping | Body template text and substitutions are both HTML-escaped (`lib/collections-template.ts`, 2 tests). |
| 6 Resend idempotency | Payload SHA-256 fingerprint stored per attempt; a changed payload is never sent (`needs_review` / `PROVIDER_PAYLOAD_CHANGED`); retries allowed only within 23 hours of the first try (W13, provider tests). |
| 7 Contract shapes | Run counts, 202 retry response and 409 `OUTSIDE_SEND_WINDOW` pinned in `2b1fce4`. |
| Mock-provider / concurrency tests | `tests/collections-phase3-provider.test.mjs` (accepted, 429, 5xx, timeout, malformed) and `tools/collections-local/test-phase3-concurrent-claim.mjs` added. |

Results on the re-integration (fresh reset with `20261018110000_collections_delivery_reason_codes.sql`):

| Check | Result |
| --- | --- |
| Reset, 5 SQL suites, `tsc --noEmit` | PASS |
| Phase 3 contract / fixes / provider / template tests | 5/5, 7/7, 5/5, 2/2 |
| UI data / render; Phase 1/2, route-access, contacts, support suites | 46 / 65; PASS |
| `validate-phase3.mjs` | 55 PASS, 0 FAIL, 0 BLOCKED |
| `test-phase3-concurrent-claim.mjs` | PASS: one owner, replay refused, no provider call |
| `validate-phase3-worker.sql` W1–W13 | As expected (W8 `OUTSIDE_SEND_WINDOW`, W11 `STAGE_NOT_DUE`, W13 fingerprint) |
| `validate-phase2.mjs` | 68/68 |
| Worker route without / with a wrong token | 401 / 401 |
| Browser (Owner) | Setup shows delivery off with 7 missing settings; history loads (200) |
| Database afterwards | 0 attempts; automation off; delivery disabled |

Engineer A approves the Phase 3 contract addendum in `2b1fce4` and confirms backend/UI integration of `c9d486f` with delivery disabled. Provider-backed test sending still needs an owner/operator configuration review (provider key, verified sender/reply-to, test mailbox, environment allowlist) and explicit approval before the first test send.

## Phase 4 contract re-review (`2b1fce4`)

All four Engineer A requests are in: stale-snapshot re-blocking, PDF-only import identity and attempt key, the permission floor (Owner/Admin edit the policy; uploader/corrector cannot approve), and the source fields on the wire; the interim-section wording is fixed. Remaining before Engineer A approves the freeze:

1. Pin row identity on the wire: worklist invoices, preview items and delivery history carry `invoice_id: string | null` (null for PDF-only) and `source_invoice_id: string | null`, plus one stable row key; `GET /deliveries` gains a `source_invoice_id` filter.
2. Record that the Phase 3 attempt model and `DeliveryAttemptSummary.invoice_id` change shape (nullable `invoice_id`, new `source`/`source_invoice_id`) through a forward migration and a Phase 3 contract addendum.
3. Add a reason code for an invoice blocked by a source discrepancy (for example `SOURCE_DISCREPANCY_BLOCKED`) so suppressed attempts explain themselves.
4. State whether a Billing-matched row can carry `source: "pdf_import"` (PDF value selected) with both IDs present.

Owner decision still open: customer linkage. Engineer A recommends requiring an imported customer to be linked to a TAP Hub client before any collection action (via an explicit, audited reviewer choice of an existing client, or the normal Add client flow). Collections contacts, holds, permissions and `last_delivery` are all keyed by client, so an import-only account would need a parallel contact and hold model.

## Phase 4 contract approval (`a07223c`, 2026-10-18)

Engineer A (UI/consumer) approves `docs/contracts/collections-phase-4-ar-pdf-intake.md` at `a07223c`. Every Engineer A request across `2b1fce4`, `083aa89`, `c2b5c0a` and `a07223c` is in: stale-snapshot re-blocking; PDF-only import identity; the permission floor; source fields, `row_key` and `canonical_collection_identity` on the wire; one row per invoice; deduplication across Billing↔PDF source switches; source-aware holds, events, approvals and "Record notice sent"; `SOURCE_DISCREPANCY_BLOCKED`; immutable canonical identity once history exists, with a late link adding only an alias; and the owner decision that imported customers are linked to a TAP Hub client before any action.

Notes for implementation, not blocking the freeze: dual-history link reconciliation stays blocked pending a separately reviewed procedure; the Phase 3 forward migration, shared types, history filters, source-aware APIs and UI row keys ship in one wave; confirm the fiscal-year boundary before configuring automatic deletion. Engineer B producer approval and the freeze are recorded in the contract by Engineer B.

COL-DEP-10 and COL-DEP-12 remain deferred owner security actions.
