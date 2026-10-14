# Handoff: Collections Phase 3 integration preparation

| Field | Value |
| --- | --- |
| Status | Phase 3 contract/prep plus independent Phase 2 security and local-harness fixes; Engineer A reports full local, SQL, API/audit, UI, and S1 access validation pass at `cc862c4`; no provider calls or hosted changes. |
| Branch | `codex/collections-phase3-contract` |
| Base | Phase 2 UI-validation branch at `dd3472f` (includes backend integration `53324a7`). |
| Contract | `docs/contracts/collections-phase-3-integrations.md` — Draft, not frozen. |
| Date | 2026-10-14 (updated) |

## Phase 2 closeout checkpoint

Phase 2 feature implementation and integrated local verification are complete for the agreed scope. Engineer A reports a clean local reset at `cc862c4`, all five SQL suites, 68/68 API/database/audit checks, H4/H5/H6 schema/fixture checks, Contacts browser loading and primary-contact audit, and S1's 12/12 access matrix. No manual SQL workaround, provider call, hosted migration, or email delivery was used.

Formal milestone closure still requires the joint branch review and the agreed merge order: backend integration first, UI branch second. Do not merge to `main` or apply hosted migrations as part of this prep.

Outstanding items are classified separately from Phase 2 feature completeness:

| Item | Classification | Handling |
| --- | --- | --- |
| H4 `contacts.updated_at` missing in local subset | Fixed and validated on `cc862c4` | Clean rebuild and primary-contact selection pass without overlay. |
| H5 selected client display/address fields missing locally | Fixed and validated on `cc862c4` | Contacts page loads in browser against local synthetic fixtures. |
| H6 fixture date uses UTC `current_date` | Fixed and validated on `cc862c4` | Fixture ages reported as deterministic 40 and 15 days. |
| A3 ambiguous contact warning wording | Low-priority UX/API alignment | The UI label was clarified; confirm the API reason and rendered warning remain semantically aligned. |
| A4 money serialization | Informational | Numeric settings may stringify without trailing zeroes; preserve exact decimal-string semantics and document/normalize if needed. |
| S1 anonymous `GET /api/contacts` service-role read | Fixed and validated 12/12 on `cc862c4`; must ship with Phase 2 | Anonymous requests receive 401; unassigned/Billing/Collections users 403; Owner/Admin/Clients-assigned staff 200; read access does not grant edit; removal of Clients access removes access immediately. |
| COL-DEP-10 shared Auth password/session rotation | Owner security action | Remains open; handle through approved credential rotation workflow. |
| COL-DEP-12 historical credential-bearing migration review | Owner security action | Remains open; separate from Phase 3 and not inspected in this prep. |
| Hosted migrations | Deferred release operation | Apply only after local integrated testing, joint review, and explicit release approval, per the owner’s decision. |

## Phase 3 objective and proposed sequence

The owner approved a **test-only email integration** over the Phase 2 preview/attempt model: Resend, a temporary synthetic-test recipient, a verified Collections business-domain sender/reply-to default, Owner escalation notification, dynamic rule eligibility, and a 9:00 AM Houston-time schedule. Engineer B owns configuring the Resend test key and exact verified sender/reply-to values. Late runs process at the next eligible scheduled run. Delivery remains disabled pending implementation and Engineer A/B review; live sending is excluded.

The client approved a separate Supabase sandbox in principle, but the owner currently lacks permission to create another project. Continue with local Supabase only. If a shared sandbox becomes available later, use synthetic fixtures only, keep it separate from production, and keep automation/email disabled by default. See `docs/decisions/2026-10-13-collections-supabase-sandbox.md`.

1. **Consumer/producer review:** Engineer A reviews exact route/UI contracts and Engineer B reviews queue/provider/security and synthetic-data enforcement.
2. **Freeze the contract:** owner decisions P3-D1–D8 and Owner/Admin “Run test now” are approved; Collections emails exclude Billing's payment URL in the initial scope. Obtain Engineer A/B approval. Keep live sending explicitly excluded.
3. **Prepare harness:** address H4/H5 and preferably H6 so local contact workflows and repeatable fixtures work without manual SQL overlays.
4. **Implement behind disabled defaults:** mock provider, test recipient rewriter, concurrency-safe worker, attempt history, sanitized audit/observability, and server-only machine authentication.
5. **Validate without sending:** mock-provider and local synthetic tests first; confirm zero network provider calls and zero delivery attempts while disabled.
6. **Optional provider test:** only after owner supplies an approved test mailbox and secret-safe non-production credential process; send synthetic fixture content to that mailbox only.
7. **Separate live-send proposal:** new contract and explicit owner/client approval for any customer-targeted communication, disclosures/opt-out, production secrets, monitoring, migration, and rollback.

## Ownership proposal

- **Engineer B:** provider adapter, idempotent queue/worker, database/RLS changes, machine-auth route, audit, failure/retry policy, and mock/integration tests.
- **Engineer A:** delivery-history UI, Owner/Admin controls, preview-vs-send clarity, disabled/error/needs-review states, responsive behavior, and browser validation.
- **Project owner/client:** decisions P3-D1–D8 recorded; retain security/release approval for any live-send proposal and confirm the remaining test-run/payment-link details.
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

Engineer A reports the latest 68-check run passed on `cc862c4` without the `contacts.updated_at` workaround. Do not point reset/test commands at a hosted project. Do not include `.env.local`, API keys, passwords, or other credential values in handoffs.
