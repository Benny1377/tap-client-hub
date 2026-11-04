# Billing foundation: Engineer A freeze acknowledgement

| Field | Value |
| --- | --- |
| Date | 2026-10-24 |
| From | Engineer A (Billing UI / workbench) |
| To | Engineer B, project owner |
| Accepts | `codex/billing-project-planning` at `7ecaee6` ("freeze remaining Phase 0 decisions") |
| Contract | `docs/contracts/billing-project-foundation.md` at `7ecaee6` |
| Decision | `docs/decisions/2026-10-19-billing-project-foundation.md` at `7ecaee6`, decisions 1–14 |
| Builds on | `docs/handoffs/2026-10-20-billing-phase0-engineer-a-review.md` (`ce4d8eb`) |
| Scope | Documentation only. No code, migration or route is changed or authorized by this acknowledgement |

## 1. Acknowledgement

Engineer A accepts the contract and decision at `7ecaee6` as the Billing foundation and has no objections. This is the acknowledgement the contract header and BILL-DEP-04 are waiting for. On Engineer B's confirmation the contract can move from Draft to Frozen.

The ten gaps in the 2026-10-20 review are closed as follows:

| # | Gap | Where closed |
| --- | --- | --- |
| 1 | Design reference | Decision 14 and the register: canonical file and hash recorded. See the caveat in section 2 |
| 2 | Page identity wording | Contract, "Identity and permission boundary": APIs resolve identity; pages render no Billing data without an authorized API response |
| 3 | Action policy shape | Fixed 14-key list, `GET /api/billing/permissions`, no default `pricing.manage` for Billing staff. `policy.manage`, `invoices.void` and `payments.reverse` always resolve to Owner/Admin, are not grantable through the policy record and are enforced by the server |
| 4 | Draft numbers | Drafts carry no number. The issue RPC allocates `TAP-YYYY-####` by issue-date year, resets the sequence annually and never reuses a voided number. Existing local drafts migrate to null |
| 5 | Candidate lifecycle | States `unpriced`, `open`, `drafted`, `dismissed`, `invoiced`; dismissal with a reason and an authorized reopen; deleting a linked draft or voiding a linked invoice reopens its candidates; candidate-to-line provenance is a junction relation |
| 6 | Price snapshot | Candidate date is the service-period end (recurring) or the completion date (one-off). The create-draft RPC copies the resolved amount and provenance onto the line; later price changes never rewrite a draft or an issued invoice; a bundle renders as one package line |
| 7 | Firm date and timezone | Houston, `America/Chicago`, from `collection_settings.timezone` |
| 8 | Operations source | Active `client_services` joined to `services`; `work_periods` (`stage = done`, `done_at`), `period_counts` or explicit manual confirmation for one-off evidence; an unmapped one-off service produces no candidate |
| 9 | Reconciliation scope | UI over the native payment and allocation APIs, an optional read-only suggestion endpoint, no new deposit entity |
| 10 | Small API items | Void reason required; invoice list filters for status, client and date |

## 2. Caveats and conditions

1. **Design hash.** The register and decision record `dev-mock/design/practiceops.html`, SHA-256 `4b795a36c34fb4664e2d5567dbdf422ef612216b2fb45dbc9515e11fbd293595`. That is Engineer A's local copy of the owner's file.
   - The original download, `practiceops_1.html`, has SHA-256 `1fac080701df032c1285374eb2ef1f41598b45454cfbe63f16c2c9fd0eec13e7`. The two differ only by one added first line, `<meta charset="utf-8">` (23 bytes); the markup, styles and script are otherwise identical.
   - The decision states the owner confirmed `practiceops_1.html` is the same design source. Engineer B has not compared a copy by hash, so the hash is not independently verified. If Engineer B's copy has the original hash above, no change is needed; if it has neither hash, the reference should be rechecked before Phase 3 work starts.
   - The file is untracked and local to each engineer. It is a workflow reference, not a contract source. Anything the contract, migrations or server routes decide takes precedence over it.
2. **Phase 3 work still waits for shapes.** This acknowledgement freezes decisions, not endpoint request and response shapes. Engineer A writes no Phase 3 workbench against an endpoint until Engineer B hands off its shape, as the contract's Phase 3 evidence requirement says. Restyling the existing three tabs inside PracticeOps needs no new backend and is not blocked.
3. **Open dependencies unchanged.** BILL-DEP-02 (the one-off completion map) blocks only the one-off part of Phase 2. BILL-DEP-03 (Engineer B's local validation of authorization, RLS, audit and migrations) must complete before a Phase 1 release claim. BILL-DEP-06 (synthetic Operations fixtures) must exist before Phase 2 validation. BILL-DEP-05 stays deferred.
4. **Phase 1 baseline still applies.** The database does not yet reject issued-line edits, line amounts that disagree with `quantity × unit_amount`, or a void with active allocations (section 3 of the 2026-10-20 review). The contract now requires all three. Engineer A will rerun those probes on the harness once Engineer B hands off the Phase 1 migration.
5. **Policy keys on the UI.** The UI will treat `GET /api/billing/permissions` as presentation only: no control is shown for a key the server did not resolve, and every action is still authorized by the server.

## 3. Base branch note: `main` has moved

BILL-DEP-01 selects `codex/security-fixes` at `6859607`. When the 2026-10-20 review was written, `main` (`210a08a`) was contained in that base. It no longer is.

| Item | Value |
| --- | --- |
| `main` head | `a94bc00`, Benny1377, 2026-10-23, "Merge pull request #1 from Max77788/main" |
| Commits not in `6859607` or `dev` | 2: `f23eaa4` ("fix: include financial month completion in exports", Max Mat) and the merge `a94bc00` |
| Files | `components/worklist-table.tsx`, `lib/export-csv.ts`, `lib/financials-export.ts` (new), `tests/export-filter-contract.test.mjs`, `tests/financials-export.test.mjs` (new) |
| Billing relevance | None. No Billing, Collections, access or migration path is touched |
| Merge into `dev` | One content conflict, in `tests/export-filter-contract.test.mjs` (`git merge-tree`); `components/worklist-table.tsx` merges automatically |
| Merge into `codex/security-fixes` | The same single conflict |

- The Billing base does not change. The register and decision describe `6859607` as the base, and that remains accurate.
- `main` is the old production branch maintained by others. Whether and when `dev` takes `main`'s export fix is the project owner's decision, not part of Billing. Engineer A has not merged anything into `main`, `dev` or the base.
- If `dev` takes the export fix later, resolve the conflict in `tests/export-filter-contract.test.mjs` as its own change, before it can interfere with Billing merges. `dev` stays tree-identical to `6859607` until then.
- Reading this note does not change the merge sequence in the 2026-10-20 review: lane branches start at `6859607`, merge the planning branch once the contract is frozen, and Engineer B's backend handoffs land before Engineer A builds against them.

## 4. Next steps

1. Engineer B confirms the freeze (Draft to Frozen) and marks BILL-DEP-04 acknowledged.
2. Engineer B works BILL-DEP-03 (Phase 1) and BILL-DEP-06 (fixtures), and hands off each endpoint shape.
3. Engineer A restyles the existing Billing tabs inside PracticeOps if the owner wants that before Phase 2, and starts Phase 3 against each endpoint only once Engineer B has handed off its shape.
