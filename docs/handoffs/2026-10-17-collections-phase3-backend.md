# Collections Phase 3 backend implementation handoff

Status: Phase 3 delivery-disabled integration was signed off by Engineer A at UI `83e2e21` + backend `af2a52e`. Follow-up hardening is validated locally but remains uncommitted/unpushed; provider-backed test sending is still not approved.

Branch base: `dev` at `727ca6a` (Phase 2 integrated baseline).
Implementation branch: `codex/collections-phase3-backend` at `af2a52e`; follow-up work is on `codex/collections-phase3-backend-hardening`, based on Engineer A's proposed fixes at `5511876`.
Contract reference: `codex/collections-phase3-contract` at `3f347e5`, with response/reason-code addendum in progress.

## Implemented in this branch

- Forward-only migration `20261017120000_collections_test_delivery.sql`: synthetic markers, `sent` → `accepted` vocabulary migration, actor-attributed off-only pause RPC, idempotent acceptance/event RPC, and a locked eligibility/claim RPC for stages 1–3.
- Owner/Admin delivery status and history endpoints, off-only pause, retry endpoint, Owner/Admin test-run endpoint, and token-authenticated worker endpoint.
- Test-only Resend adapter, HTML escaping and placeholder allowlist enforcement, configured-recipient-only routing, provider idempotency key, bounded attempts, and fail-closed environment/readiness checks.
- Worklist `last_delivery`, preview `delivery_attempt`, synthetic markers on local fixtures, and shared Phase 3 API types.
- `POST /api/collections/automation/test-run` returns `{ run_id, claimed, accepted, suppressed, needs_review, failed, remaining }`; this pins the response shape raised in the consumer review.
- Engineer A's send-window and suppressed-reopen fixes: requests outside the firm window return `409 OUTSIDE_SEND_WINDOW` before creating attempts; blocked queued attempts return to `suppressed`; already handled attempts are skipped.
- Fixed stage-4 subject and first body heading: `Internal Owner-escalation notice — TEST`. Both body template text and substitutions are HTML-escaped.
- Forward-only migration `20261018110000_collections_delivery_reason_codes.sql`: precise `STAGE_NOT_DUE`, `INVOICE_NOT_ELIGIBLE`, and `OUTSIDE_SEND_WINDOW` database codes; per-attempt SHA-256 provider-payload fingerprint prevents a changed retry body from reaching Resend.
- Provider adapter is injectable; mock tests cover acceptance, 429, 5xx, timeout, malformed response, stable key/payload retry, and escaping/token rules. A local-only two-connection test proves that only one concurrent claim can own an attempt.

## Required server-only configuration names

Never commit their values or expose them to the browser:

- `COLLECTIONS_MODE=test`
- `COLLECTIONS_NON_PRODUCTION=true`
- `COLLECTIONS_ALLOWED_PROJECT_REF` (for a non-local sandbox; local loopback is separately recognized)
- `COLLECTIONS_AUTOMATION_KILL_SWITCH=true` to force pause
- `COLLECTIONS_RESEND_API_KEY`
- `COLLECTIONS_SENDER_EMAIL`, `COLLECTIONS_SENDER_NAME`, `COLLECTIONS_SENDER_VERIFIED=true`
- `COLLECTIONS_REPLY_TO`, `COLLECTIONS_TEST_RECIPIENT`
- `COLLECTIONS_WORKER_TOKEN`, `COLLECTIONS_SYSTEM_ACTOR_ID` (machine worker only)

Database `delivery_mode` must also be `test`, and `automation_enabled` must be true for a test run. It defaults off. No live mode exists. Do not enable a provider key or run a test send until the local validation and owner/operator configuration review are complete.

## Validation still required

Validation completed on a fresh disposable local reset: all five SQL suites; 18/18 Phase 3 backend/fix/provider/template tests; concurrent claim test; TypeScript typecheck; targeted ESLint; `git diff --check`. Automation was restored to disabled and no provider calls were made. Engineer A previously reported Phase 2 68/68 and Phase 3 55/55 on the integrated UI/backend branch; those authenticated route/browser suites were not rerun here.

1. Engineer A should rebase/review this hardening branch and rerun the integrated Phase 2 68-check suite, Phase 3 55-check suite, and browser/access matrix.
2. Review the Phase 3 contract addendum for the retry response, exact run-count shape, refusal codes, payload-fingerprint behavior, and Resend idempotency caveat.
3. Complete the Owner/Operator configuration review. Do not add a provider key or make a provider-backed test send until the owner explicitly approves that gate.

No hosted migration, real provider request, production recipient, scheduler, or live-client send was performed as part of this implementation.
