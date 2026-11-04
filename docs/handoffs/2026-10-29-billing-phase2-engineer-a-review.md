# Billing Phase 2: Engineer A review of the draft contract

| Field | Value |
| --- | --- |
| Date | 2026-10-29 |
| From | Engineer A (Billing UI / workbench) |
| To | Engineer B, project owner |
| Reviews | `docs/contracts/billing-phase-2-pricing-and-candidates.md` and `docs/handoffs/2026-10-29-billing-phase2-preparation.md` on `codex/billing-phase2-prep` at `4159375` |
| Also read | The frozen foundation contract and decision (`b5a9077`), and the Phase 1 code on `73f4d2a` |
| Status | Read-only review. No code, migration or route is changed or authorized by it |
| Position | Engineer A accepts the Phase 2 scope and the rules in "Non-negotiable rules". The items in section 1 need an answer or a wording change before the contract is frozen. Engineer A will not build against any Phase 2 endpoint until its shape is frozen |

## 0. Gates

- **Phase 1 release evidence** (first gate in the draft): Engineer A's acceptance is in `docs/handoffs/2026-10-29-billing-phase1-engineer-a-acceptance.md`. What remains is Engineer B recording his own matrix.
- **Phase 2 UI:** the draft says the Phase 3 workbench carries the configuration screens. Agreed.
- **Local fixtures:** BILL-DEP-06 is delivered locally. See item 12 about how far they can stand in for the hosted Operations tables.

## 1. Gaps to close before freeze

1. **Invoice numbering and the issue step.** The frozen decision says drafts carry no number and the issue RPC allocates `TAP-YYYY-####` and snapshots remittance. The Phase 2 draft does not say which phase delivers that. It is needed in Phase 2 because:
   - `invoices.invoice_number` is `not null unique` and `POST /api/billing/invoices` requires the caller to send it, so a draft created from candidates has nowhere to start;
   - the `invoiced` candidate state can only be set by the issue step.

   Proposal: Phase 2 includes the migration (draft numbers nullable, number allocated at issue, sequence per issue-date year, voided numbers never reused) and the issue RPC. The remittance snapshot column is added now and stays empty until Phase 3 settings exist, or the settings table moves into Phase 2. Please choose.
2. **Void and delete must become candidate-aware in one transaction.** The draft says deleting a linked draft or voiding a linked invoice restores candidates. Today the void route is a plain `update` and the draft delete is an RPC. The void must become an audited RPC (and the Phase 1 tests and validators updated with it). Please list that migration and route change in Phase 2's scope and evidence.
3. **Permission policy records are missing from the data boundary.** The API table authorizes by `pricing.view`, `pricing.manage`, `candidates.view`, `candidates.manage` and `invoices.draft.manage`, but no policy table, resolver or `GET /api/billing/permissions` is listed, and nothing says whether the existing Phase 1 routes move from the module check to these keys. Needed: where the policy lives (single-row policy in the style of `collection_import_permissions`), defaults per role, that `policy.manage`, `invoices.void` and `payments.reverse` always resolve to Owner/Admin, and the response shape the UI will receive.
4. **Terms and date storage.** The frozen decision sets Net 15 with a client override and a billing-day default with an override, and the firm timezone. No table, endpoint or policy key in this draft stores them (`settings.terms.manage` exists as a key only). The create-draft call also needs a rule for the issue date and due date it assigns (candidate date, run date, or the caller's choice). Please say which phase owns the storage and who computes the dates.
5. **"What bills next" read.** The design's three-month view shows amounts for months that have no candidates yet, but candidates only exist after the explicit generate call. Either:
   - add a read-only projection endpoint (`GET /api/billing/candidates/schedule?from=&to=`) that computes projected rows without persisting and marks them as projected, or
   - state that candidates for the next three runs are generated ahead of time.

   The first keeps generation an explicit audited act. Please choose.
6. **Endpoints and errors are placeholders.** `/api/billing/pricing/...` is not a path. To freeze: exact paths and verbs for rate cards and entries, client-service overrides, bundles and components; a reprice operation (the lifecycle table has a "reprice" transition but no endpoint); the candidate list parameters (client, state, date window, paging) and sort; what generate returns (created, existing and skipped counts plus ids); the shape of a duplicate result; and a table of error codes with their HTTP statuses. Only `CANDIDATE_NOT_OPEN` and `CANDIDATE_UNPRICED` are named.
7. **Money in responses.** The foundation contract says money is transported as decimal strings or integer cents. The current Phase 1 routes return `numeric` columns as JSON numbers (for example `amount: 12.35`). Please state that every new price, candidate and draft field is a decimal string, and decide whether the Phase 1 routes are changed to match.
8. **Collections-only access.** The draft says Collections-only responses "exclude price-bearing fields". Proposal: pricing, candidate and completion-map endpoints return 403 to Collections-only sessions rather than a redacted body, so nothing price-shaped can leak through a new field later.
9. **Bundle lines.** Say how a package line maps onto `invoice_lines`. Since Phase 1 the database enforces `amount = round(quantity × unit_amount, 2)` and only draft lines are writable, so the simplest rule is quantity `1`, unit amount equal to the bundle price. Also say what a component candidate's own amount is (for provenance and for return-to-open) and how component amounts are rounded so they reconcile to the package price.
10. **Editing a draft built from candidates.** The Phase 1 UI lets staff edit or remove any line on a draft. For candidate-linked lines the draft is silent. Please decide: removing a linked line returns its candidates to `open`; editing a linked line's quantity, unit or amount is refused (409) because the price is a snapshot; manual lines can be added alongside. Engineer A needs this to design the draft screen.
11. **Firm date.** Candidate dates, "final calendar day of the service period" and generation windows should all use the firm date in `America/Chicago` read from `collection_settings.timezone` (decision 14). Please say so in the contract and test it near month end and a daylight-saving change.
12. **Operations tables in the hosted schema.** The adapters read `client_services`, `services`, `work_periods` (`stage`, `done_at`) and `period_counts`. The local fixture schema in `tools/collections-local` is local-only, and the hosted shapes of these tables have not been inspected for Billing. Please confirm the adapters are written against a schema export, not only the fixture, and that the Phase 2 migration does not create or alter Operations tables.
13. **Generation scope and idempotency.** State the maximum window per call, whether a re-run over the same window returns the existing candidates unchanged, and how a service whose map is disabled after generation behaves (existing candidates stay; no new ones).
14. **Who may dismiss and reopen.** The draft lists `candidates.manage` for both. Please confirm there is no separate key, and that dismissal requires a non-empty reason in the database, not only the route.
15. **Provenance immutability.** "Issued provenance is immutable" needs a database rule like the Phase 1 line triggers, not only route checks, and a test that a link cannot be moved after issue.

## 2. Suggestions (can be settled in the API freeze)

- Provide synthetic example JSON for every endpoint in the freeze handoff so the UI can be built and tested against fixtures.
- Keep candidate and pricing writes behind one resolver so a single `403` mapping covers all new routes.
- Record in the evidence table that existing Phase 1 validators (`validate-phase2.mjs`, `validate-phase4.mjs`, the invariants SQL) are rerun after the void and issue changes.
- Name the order of the Phase 2 migrations and add each to `tools/collections-local/reset.sh` in the same commit, as in Phase 1.

## 3. What Engineer A needs to start Phase 3 work

| Screen | Needs from Phase 2 |
| --- | --- |
| What bills next | The schedule read (item 5), candidate states including `unpriced`, create-draft |
| Clients & prices | Rate card, overrides, bundles and effective dates; per-client resolved prices; the permissions response (item 3) |
| Invoices | Draft creation from candidates, issue with numbering (item 1), the line-edit rules (item 10), list filters |
| Settings | Terms and billing-day storage (item 4), remittance (Phase 3) |
| Configuration of completion rules | The completion-source map read and write with its validation errors |

Until those shapes are frozen, Engineer A's only UI work that needs no new backend is what is already done: the restyle and the Phase 1 follow-ups on `codex/billing-phase1-ui`.
