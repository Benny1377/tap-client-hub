# Handoff: Collections Phase 3 integration preparation

| Field | Value |
| --- | --- |
| Status | Phase 3 contract/prep plus independent Phase 2 security and local-harness fixes; static contact contract test passes. Full database/browser validation pending; no provider calls or hosted changes. |
| Branch | `codex/collections-phase3-contract` |
| Base | Phase 2 UI-validation branch at `dd3472f` (includes backend integration `53324a7`). |
| Contract | `docs/contracts/collections-phase-3-integrations.md` — Draft, not frozen. |
| Date | 2026-10-13 (updated) |

## Phase 2 closeout checkpoint

Phase 2 feature implementation and integrated local verification are complete for the agreed scope. The latest developer report records a clean local reset, all five SQL suites, 68/68 API/database/audit checks, and Owner plus Collections-staff browser validation against backend `53324a7` and the updated UI branch. A fresh local rerun on this branch also reached 68/68 after applying the already-documented contacts-schema workaround. Delivery remained disabled; no messages were sent.

Formal milestone closure still requires the joint branch review and the agreed merge order: backend integration first, UI branch second. Do not merge to `main` or apply hosted migrations as part of this prep.

Outstanding items are classified separately from Phase 2 feature completeness:

| Item | Classification | Handling |
| --- | --- | --- |
| H4 `contacts.updated_at` missing in local subset | Harness fix included in this branch; validation pending | Local bootstrap now defines `updated_at`; confirm clean reset, no overlay, and contact update/primary selection pass. |
| H5 selected client display/address fields missing locally | Harness fix included in this branch; validation pending | Local clients bootstrap and synthetic fixtures now include the fields selected by Contacts; verify a full Contacts-page browser pass. |
| H6 fixture date uses UTC `current_date` | Harness fix included in this branch; validation pending | Seed dates now derive from `collections_firm_today()` to remain stable across UTC/local date boundaries. |
| A3 ambiguous contact warning wording | Low-priority UX/API alignment | The UI label was clarified; confirm the API reason and rendered warning remain semantically aligned. |
| A4 money serialization | Informational | Numeric settings may stringify without trailing zeroes; preserve exact decimal-string semantics and document/normalize if needed. |
| S1 anonymous `GET /api/contacts` service-role read | Security fix included in this branch; regression validation pending | GET now resolves a signed-in identity and requires the Clients module before service-role reads; verify anonymous 401, unauthorized-role 403, and assigned-user/Owner success before release. |
| COL-DEP-10 shared Auth password/session rotation | Owner security action | Remains open; handle through approved credential rotation workflow. |
| COL-DEP-12 historical credential-bearing migration review | Owner security action | Remains open; separate from Phase 3 and not inspected in this prep. |
| Hosted migrations | Deferred release operation | Apply only after local integrated testing, joint review, and explicit release approval, per the owner’s decision. |

## Phase 3 objective and proposed sequence

The current owner direction is to defer sender, test recipient, and delivery integration until the integration phase. This handoff makes that phase actionable without enabling sending. The proposed Phase 3 starting scope is a **test-only email integration** over the Phase 2 preview/attempt model. Resend is an implementation candidate because this repository already calls it for 2FA and support notifications; the Collections-specific provider, API key, sender, and test mailbox are still owner decisions.

The client approved creation of a separate Supabase sandbox project. Provisioning details are not yet selected; use synthetic fixtures by default, keep the project separate from production, and keep automation/email disabled. See `docs/decisions/2026-10-13-collections-supabase-sandbox.md`.

1. **Owner/consumer review:** resolve the `P3-D1` through `P3-D8` questions in the draft contract; Engineer A reviews route/UI contract, Engineer B reviews queue/provider/security design.
2. **Freeze the contract:** approve exact stage behavior, provider/credential boundary, sender/reply-to, test recipient, synthetic-data policy, and job schedule. Keep live sending explicitly excluded.
3. **Prepare harness:** address H4/H5 and preferably H6 so local contact workflows and repeatable fixtures work without manual SQL overlays.
4. **Implement behind disabled defaults:** mock provider, test recipient rewriter, concurrency-safe worker, attempt history, sanitized audit/observability, and server-only machine authentication.
5. **Validate without sending:** mock-provider and local synthetic tests first; confirm zero network provider calls and zero delivery attempts while disabled.
6. **Optional provider test:** only after owner supplies an approved test mailbox and secret-safe non-production credential process; send synthetic fixture content to that mailbox only.
7. **Separate live-send proposal:** new contract and explicit owner/client approval for any customer-targeted communication, disclosures/opt-out, production secrets, monitoring, migration, and rollback.

## Ownership proposal

- **Engineer B:** provider adapter, idempotent queue/worker, database/RLS changes, machine-auth route, audit, failure/retry policy, and mock/integration tests.
- **Engineer A:** delivery-history UI, Owner/Admin controls, preview-vs-send clarity, disabled/error/needs-review states, responsive behavior, and browser validation.
- **Project owner/client:** provider choice, dedicated credential approval, sender/reply-to, test recipient, copy/disclosure review, schedule/cadence, and separate live-send authorization.
- **Codex prep branch:** contract/handoff/index coordination only. No provider credential, actual email send, production migration, or implementation change is included here.

## Phase 3 acceptance checklist (proposed)

- [ ] Contract is frozen by producer and consumer; owner decisions are recorded.
- [ ] Every delivery stays disabled by default; missing configuration fails closed.
- [ ] Test mode has no recipient input and cannot target a client address.
- [ ] Only synthetic fixture content reaches any external provider during test validation.
- [ ] Stage 4 is never client-facing; stage 5 requires explicit Owner/Admin approval.
- [ ] Payment, hold, stage, contact, timezone/window, and rule preconditions are rechecked immediately before send.
- [ ] Idempotency, concurrent worker claims, provider timeouts, safe retry, and `needs_review` are covered.
- [ ] Access matrix, RLS, audit actor, sanitized logs, provider-failure UI, and reload behavior pass.
- [ ] Phase 2 branch review/merge and separate S1/security release gate are resolved before release.
- [ ] No live client send or hosted migration occurs without the explicit release gate.

## Reproduction / current environment

The local Supabase harness is `tools/collections-local`; it uses fictional `.invalid` profiles and the app/provider delivery is disabled. The local Phase 2 API check is:

```sh
bash tools/collections-local/reset.sh --local
bash tools/collections-local/test.sh --local
node tools/collections-local/create-test-users.mjs
PSQL=psql node tools/collections-local/validate-phase2.mjs
```

The integrated 68-check run also needs the documented **local-only** `contacts.updated_at` workaround until H4 is fixed in the harness bootstrap. Do not point these commands at a hosted project. Do not include `.env.local`, API keys, passwords, or other credential values in handoffs.
