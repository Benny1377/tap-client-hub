# Billing Phase 3 and Collections: Engineer A final validation

| Field | Value |
| --- | --- |
| Date | 2026-11-06 |
| From | Engineer A |
| To | Engineer B, project owner |
| Reviews | `acda900` (Phase 3 screens), `c684300` (A/R refresh safety) |
| Tested on Preview | `b0607fb` at `https://tap-client-hub-test.vercel.app` |
| Database | TAB-HUB sandbox, `vuqgxotdccxivjmavsoj.supabase.co` |
| Evidence | `2026-11-06-billing-phase3-final-preview-results.txt` |
| Outcome | **Phase 3 screens 1 to 4 pass and are merged to `dev`.** Two A/R backend bugs remain open, listed in section 4 |

## 1. What was integrated

`dev` at `999029b`, `acda900`, `c684300`, and Engineer A's screen 1.

Engineer B's screens 2 to 4 are kept. Engineer A's screen 1 replaces `candidate-workbench.tsx` and `candidate-options.ts`, because those lacked dismiss, reopen and reprice, the No price and Dismissed lists, and removal of locked lines. They also found packages by `priceSource`, while the server uses package membership.

Front-end changes on top of `acda900`:

- Screen 2 no longer says generation is Owner/Admin-only, because `candidates.manage` is delegable.
- The client picker no longer widens the page on a phone. This came after the hosted run; it was checked locally with a long client name, not on the Preview.

Contract: confirmed. State is Frozen, and the `pricing.manage` example now says `"enabled":true`.

## 2. Results

| Check | Local | Preview |
| --- | --- | --- |
| Unit tests | 151/151 | n/a |
| Phase 1 / Phase 2 route matrices | 37/37, 89/89 | not repeated, permanent rows |
| SQL checks, `tsc` | Pass | n/a |
| Payroll API rules | 35/36, known local fixture | 36/36 |
| Phase 3 reads | n/a | 14/14 |
| Collections-only refusals | n/a | 4/4 |
| Payroll fields in browser | 13/13 | 13/13 |
| Billing draft flow | 7/7 | 7/7 |
| Screen 1 in browser | 16/16 | 13/13, see section 3 |
| Screens 2 to 4 and roles in browser | 26/26 | 22/23, the miss is the picker width, fixed afterwards |
| Synthetic A/R flow | 12/14 | 12/14, the two misses are section 4 |

Local runs of the browser checks, matrices and A/R flow came before the last two small commits. Unit tests and `tsc` were rerun at the end. `tsc` passes here; the `pdfjs-dist` error Engineer B sees does not occur in this checkout.

Roles checked on the Preview: Owner/Admin, Billing staff, Collections-only, unassigned. A staff user with a reduced delegated policy is covered by render tests only.

## 3. Differences between local and hosted runs

- **Screen 1:** the hosted run deletes its draft instead of issuing and voiding, so it left no permanent invoices. Issue and void through the UI ran locally only.
- **Shared settings:** policy, terms and remittance saves ran locally only. The Preview read them and left them alone.
- **Policy save:** the save of the unchanged policy ran locally only.
- **A/R flow:** the first hosted run failed six more checks for test reasons, not app reasons. The client name has digits, and hosted storage kept serving the old PDF after an overwrite. The script was corrected, no app code changed, and the final run is the one reported.

## 4. Collections results

| Request | Result |
| --- | --- |
| 1. Failed refresh leaves the batch in `needs_review` | Pass |
| 2. Retry of a failed batch keeps decisions, no delete and rebuild | Rows and decisions kept: pass. **Status: fail, bug B** |
| 3. Separate approver puts invoices in the worklist | Pass on `d9cfed0c`. Uploader and reviewer refused, separate Admin approved, both invoices in the worklist |
| 4. Candidates on synthetic data | Pass: 69% and higher, labelled for verification |

Delivery stayed disabled: mode `disabled`, 0 attempts, 0 events.

**Bug A: new reports cannot be parsed.** The first parse of any detail report with mixed rows fails with `500 IMPORT_ROWS_WRITE_FAILED`, locally and on the Preview. In the parse route, only auto-classified rows carry `review_disposition`. The array insert sends null for the rest, which breaks the NOT NULL column (23502). Likely fix: set `review_disposition` on every row, with `"unreviewed"` as the default. Present since `f9c729f`. The checks reached their later steps by seeding placeholder rows and using the refresh path.

**Bug B: a successful retry leaves the batch `failed`.** The response says `needs_review`, but the refresh branch updates metadata only, so the stored status stays `failed`.

**Parser note, no change requested:** a standalone heading containing digits, such as "Route 66 LLC", is not treated as a customer heading, so its cut-off rows stay in manual review. That is safe, but real customers may be affected.

## 5. Left in the sandbox

- Approved synthetic batch `d9cfed0c` with 2 worklist invoices. Permanent.
- Rejected synthetic batches `7280e321` (intact, as requested), `f580c368`, `3147d4aa`.
- Tagged services, client services, rate cards, packages, maps, candidates and audit rows on the synthetic client.
- `a8dc99de` and `c9c65d41`, the real report batches, are untouched by this run.

## 6. Sandbox migrations

The six files `20261104100000` to `20261104150000` were not found in any fetched branch, stash, dangling commit or local folder. `supabase migration fetch` should restore them from the remote history table, which stores each migration's SQL. The mirror was not changed, and nothing was pushed to the database.

## 7. Remaining gates

Before production: the read-only direct-access check for payroll and EFTPS on Operations, and the read-only adapter compatibility run on Operations. Credential rotation stays on hold by owner decision.
