# Collections Phase 3 backend implementation handoff

Status: implementation branch only; not yet locally database-tested, Engineer B producer-approved, or pushed.

Branch base: `dev` at `727ca6a` (Phase 2 integrated baseline).
Implementation branch: `codex/collections-phase3-backend`.
Contract reference: `codex/collections-phase3-contract` at `3f347e5`.

## Implemented in this branch

- Forward-only migration `20261017120000_collections_test_delivery.sql`: synthetic markers, `sent` → `accepted` vocabulary migration, actor-attributed off-only pause RPC, idempotent acceptance/event RPC, and a locked eligibility/claim RPC for stages 1–3.
- Owner/Admin delivery status and history endpoints, off-only pause, retry endpoint, Owner/Admin test-run endpoint, and token-authenticated worker endpoint.
- Test-only Resend adapter, HTML escaping and placeholder allowlist enforcement, configured-recipient-only routing, provider idempotency key, bounded attempts, and fail-closed environment/readiness checks.
- Worklist `last_delivery`, preview `delivery_attempt`, synthetic markers on local fixtures, and shared Phase 3 API types.
- `POST /api/collections/automation/test-run` returns `{ run_id, claimed, accepted, suppressed, needs_review, failed, remaining }`; this pins the response shape raised in the consumer review.

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

Static checks completed: TypeScript typecheck, targeted ESLint, five backend contract checks, and `git diff --check` pass.

1. Run the local SQL suites and Phase 2 68-check suite on a disposable local database after the migration is reviewed. Do not run `tools/collections-local/reset.sh` against a database containing data that must be kept; reset is destructive.
2. Run Engineer A's `tools/collections-local/validate-phase3.mjs` after merging/rebasing the UI branch, initially with delivery disabled. Require zero provider calls and zero new attempts from the blocked test-run path.
3. Add mock-provider tests for accepted, 429, 5xx, timeout/unknown, and malformed responses; test concurrent claims, transient retry, suppression reopening, token escaping, and no recipient fallback.
4. Validate Owner/Admin, staff, anonymous, and worker-token access. Validate audit actor values for pause, retry, manual run, and machine run.
5. Review stage 4/5 behavior with Engineer A: stage 4 sends a synthetic internal review notification only to the configured test mailbox; stage 5 is sent there only after an explicit `formal_notice_approved` event and never writes `formal_notice_sent`.

No hosted migration, real provider request, production recipient, scheduler, or live-client send was performed as part of this implementation.
