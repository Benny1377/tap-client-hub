# Billing Phase 0: Engineer A acknowledgement and contract review

| Field | Value |
| --- | --- |
| Date | 2026-10-20 |
| From | Engineer A (Billing UI / workbench) |
| To | Engineer B |
| Responds to | `docs/handoffs/2026-10-19-billing-project-initialization.md` on `codex/billing-project-planning` at `dbea629` |
| Contract reviewed | `docs/contracts/billing-project-foundation.md` at `dbea629`: **Draft**. Engineer A accepts it for freeze once the gaps in section 4 are closed |
| Decision | `docs/decisions/2026-10-19-billing-project-foundation.md` at `dbea629`: Approved, decisions 1–13. No objections |
| Status | Read-only review. No code, migrations or routes changed |

## 1. Acknowledgement

| Item | Engineer A position |
| --- | --- |
| Base | `codex/security-fixes` at `6859607` (BILL-DEP-01, approved). Ancestry in section 2 |
| Engineer A branch | `codex/billing-workbench-ui`, cut from `6859607` |
| Contract state | Draft. Accepted except for the gaps in section 4 |
| Owned paths (Engineer A) | `app/billing/**`; `components/billing/{invoice-panels,payment-panels,ui}.tsx`, `components/billing/use-ledger.ts` and new workbench components under `components/billing/`; `lib/billing-ui/**` (shared with the Collections UI, which Engineer A also owns); `tests/billing-ui-*.test.mjs`; Billing entries in `components/practiceops/apps.ts` |
| Not owned (Engineer B) | `supabase/migrations/**`, `app/api/billing/**`, `lib/billing-access.ts`, `lib/billing-audit.ts`, `lib/access-policy.ts`, `lib/access-server.ts`, `tools/collections-local/{reset.sh,seed.sql}` |
| Shared | `docs/coordination/**`, cross-module validation, `tools/collections-local/validate-*.mjs` |
| API dependencies for Phase 3 | Section 5. No Phase 3 UI against unfrozen shapes (BILL-DEP-04) |
| Local test setup | Section 6 |
| Blockers | The section 4 gaps (BILL-DEP-04); BILL-DEP-02 for the one-off part of Phase 2; BILL-DEP-06 for Phase 2 evidence |

## 2. Base and ancestry (BILL-DEP-01)

Checked against the remote heads on 2026-10-20.

**`6859607` first-parent history back to `202cba1`:**

| Commit | What it brings |
| --- | --- |
| `6859607` | Server-side access, sign-in and dependency fixes |
| `da446b8`, `9182d18`, `61e870d`, `4a80ccf` | Shell and Collections copy fixes; source-contract test updates |
| `c919096` | Merge of `codex/practiceops-ui` (`1f5a010`): the PracticeOps launch pad, top bar and rail |
| `7ce111c` | Merge of `codex/collections-phase4-backend` (`202cba1`) |
| `0b9509f` … `117d722` | Collections Phase 4 UI and local validation |
| `6daf4b4`, `0eca9d3` | Earlier Phase 4 backend merges (`e3bfcd5`, `be2aa41`) |
| `7069655` | `dev` at Collections Phases 1–3 |

- `main` (`210a08a`), `dev` before its latest merge (`7069655`), `codex/practiceops-ui` (`1f5a010`), `codex/collections-phase4-backend` (`202cba1`) and `codex/collections-phase4-ui` (`da446b8`) are all ancestors of `6859607`.
- **`dev` already contains the base.** `dev` is at `e1d43b3`, which merges `6859607` into `7069655`. Its tree is identical to `6859607`'s, so later Billing merges into `dev` carry only Billing changes.
- `codex/billing-project-planning` (`dbea629`, merge base `202cba1`, docs only) still merges into both `6859607` and `dev` with no conflicts (`git merge-tree`).

**Proposed sequence** (nothing touches `main`):

1. Each lane branch starts at `6859607` and merges `codex/billing-project-planning` once the contract is frozen.
2. Engineer B's Phase 1 / Phase 2 backend branches land first; `codex/billing-workbench-ui` merges each backend handoff before building against it.
3. Merges into `dev` stay a separate decision for each phase.

**Migration order.** The newest migration on the base is `20261019140000_collections_test_delivery_source_discrepancy.sql`. New Billing migrations go only in `supabase/migrations/`, timestamped after `20261019140000`, forward only, each added to the list in `tools/collections-local/reset.sh` in the same commit. The legacy `0001`–`007` files stay as they are (`007` is already a no-op).

## 3. Phase 0 inventory (base `6859607`)

- **Tables** (`20261009120000`): `invoices`, `invoice_lines`, `payments`, `payment_allocations`, `external_account_ids`, `collection_holds`, `collection_events`. RLS is on for all seven; no `anon` or `authenticated` grants; writes go through `service_role`.
- **Functions**: `allocate_payment`, `reverse_payment`, `reverse_payment_allocation`, `delete_draft_invoice`, `delete_draft_invoice_line`, `get_billing_receivables`, `record_billing_audit`, `audit_billing_row` (audit triggers on all seven tables), plus the Collections event and hold RPCs.
- **Routes**: `app/api/billing/{invoices, invoices/[id], invoice-lines, payments, payments/[id], allocations, allocations/[id], receivables}`. Access is `requireBillingAccess`, `requireBillingPowerUser` (void, reversals) and `requireLedgerReadAccess` (Billing or Collections) in `lib/billing-access.ts`. Error bodies already match decision 6.
- **UI**: `app/billing/page.tsx` with Invoices, Payments and Receivables tabs; `components/billing/*`; `lib/billing-ui/*` (shared with Collections).
- **Tests**: `tests/billing-ui-{data,render,imports}.test.mjs`, the Collections contract tests, `tests/regression-access-policy.mjs`, `tests/security-hardening.test.mjs`; the local validator `tools/collections-local/validate-phase2.mjs` (68/68 on the last run) covers the ledger through the real routes.
- **Not present**: pricing, rate card, overrides, bundles, candidates, remittance or Billing settings, a Billing action policy, invoice numbering. Phase 2 duplicates nothing.
- **Reusable pattern**: `collection_import_permissions` (single-row `jsonb` policy, Phase 4) is a working Owner/Admin-managed policy.

### Baseline for the new database rules

The contract now requires the database to enforce these. On the local harness at `6859607` (run as the database owner inside a rolled-back transaction) the database does not yet; the routes block the first three:

| Probe | Result today |
| --- | --- |
| Update `invoice_lines.amount` on an issued invoice | Accepted |
| Insert a line with `quantity 2`, `unit_amount 10`, `amount 5` | Accepted |
| Void an issued invoice with an active allocation | Accepted; the allocation stays active against a void invoice |
| `POST /api/billing/invoice-lines` amount | Computed in JavaScript numbers; `quantity` parsed to two decimals although the column allows four |

## 4. Remaining gaps before freeze

Everything else from the 2026-10-19 review is resolved by `dbea629`.

1. **Design reference.** The docs still cite `practiceops_1.html`; Engineer A's copy is `dev-mock/design/practiceops.html`. Neither is in Git. Confirm they are the same file and record one name, ideally with a hash.
2. **Page identity wording.** "Every page and API resolves authenticated identity … server-side" is unchanged. Billing pages are client components: `proxy.ts` checks only that a session cookie exists, the shell gates on `/api/me`, and all data comes from server-checked APIs. Either reword to "every API checks identity and module access; pages render no Billing data without an authorized API response", or make server-side page gating a requirement with an owner.
3. **Action policy shape.** Decision 7 settles where permissions are calculated. Still needed for the API freeze:
   - the fixed action keys;
   - which endpoint returns the caller's resolved action set (a field on `/api/me`, or a Billing endpoint);
   - whether "Maintain pricing and billable rules" is granted to Billing-module users by default or only after an Owner/Admin enables it. Engineer A suggests not by default.
4. **Draft numbers.** Decision 11 allocates `TAP-YYYY-####` at issue, but `invoices.invoice_number` is `not null unique` and `POST /api/billing/invoices` requires the caller to supply it. Needed:
   - drafts carry no number (the column becomes nullable for drafts), and the create route stops accepting one;
   - what `YYYY` is (issue date or allocation date), whether the sequence restarts each year, and that a voided number is never reused;
   - what happens to existing local drafts that already have numbers.
5. **Candidate lifecycle.** Identity is settled (decision 9). Still undefined:
   - candidate states besides `unpriced` (for example open, drafted, dismissed), and whether a user can dismiss or skip one;
   - the link from `invoice_lines` back to its candidate;
   - what happens to the candidate when its draft is deleted (reopens?) or its invoice is voided;
   - whether creating drafts from selected candidates is one RPC.
6. **Price snapshot.** Resolution order is settled (decision 10). Still undefined:
   - the "candidate date" for each type: the billing date or period end for recurring, and the completion date for one-off?
   - whether a draft line snapshots the resolved price, and whether a later price change ever updates an open draft;
   - whether a bundle bills as one line or as component lines.
7. **Firm date and timezone.** "Final calendar day of the service period" and Net 15 need a firm date and timezone. Reuse the Collections firm date in `collection_settings`?
8. **Operations source.** BILL-DEP-06 covers fixtures. Name the Operations tables that supply enrollment, schedule and completion facts (is `work_periods` status the completion signal?) and Billing's read access to them.
9. **Phase 3 reconciliation scope.** Confirm "manual reconciliation" means UI over the existing payment and allocation APIs, plus an optional read-only suggestion endpoint, and no new deposit entity.
10. **Small API items.** Make the void reason required (it is optional in the route today), and add status, client and date filters to `GET /api/billing/invoices`.

## 5. API dependencies for the Phase 3 workbench

| Area | Needed |
| --- | --- |
| Pricing | Rate card list and maintain; client-service overrides and bundles with effective dates; per-client resolved price lines |
| Candidates | List for a date window (the design's three-month "What bills next"), including `unpriced`; create drafts from selected candidates; candidate status |
| Invoices | Existing routes; issue RPC returning the allocated number and remittance snapshot; list filters |
| Settings | Remittance instructions (Owner/Admin); default terms and client terms override; service-period billing-day override |
| Permissions | Caller's resolved Billing action set; policy read and update for Owner/Admin |
| Reconciliation | Existing payments and allocations; optional suggestion read model |

Until these are frozen, the only Billing UI work that needs no new backend is restyling the existing three tabs inside PracticeOps.

## 6. Local test setup (Engineer A)

- Local Supabase harness only (`tools/collections-local`, API `127.0.0.1:55321`). Reset with `reset.sh --local`, then `create-test-users.mjs`. Synthetic clients `LOCAL-001` and `LOCAL-002`; `.invalid` test logins for Owner, Admin, Billing staff, Collections staff and unassigned staff.
- Dev server on port 3002 with the fake Resend provider preloaded.
- Checks per change: unit and source-contract tests (`node --experimental-strip-types --test tests/*.mjs`), `tsc`, lint on changed files, build, `validate-phase2.mjs` whenever the ledger is touched, and a browser check with Owner and Billing-staff sessions.
- The harness has only a stub `client_services` (`id`, `client_id`) and no services or `work_periods` tables, so Phase 2 UI checks wait on BILL-DEP-06.
