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

COL-DEP-10 and COL-DEP-12 remain deferred owner security actions.
