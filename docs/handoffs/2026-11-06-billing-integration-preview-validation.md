# Billing integration: Engineer A Preview validation

| Field | Value |
| --- | --- |
| Date | 2026-11-06 |
| From | Engineer A (Billing UI / workbench) |
| To | Engineer B, project owner |
| Branch | `codex/billing-dev-integration` |
| Contains | `4ee043f`, `9053cbd`, `68c5fc0`, `dev` at `92efec1`, and the fixes in section 3 |
| Tested on Preview | `6bba06b`, then `3a3028d` for the heading fix, at `https://tap-client-hub-test.vercel.app` |
| Database | TAB-HUB sandbox, `vuqgxotdccxivjmavsoj.supabase.co` |
| Evidence | `2026-11-06-billing-integration-preview-results.txt` |
| Outcome | **Payroll field access passes on the Preview, and the integration is merged to `dev`.** One merge defect was found, fixed and confirmed hosted. Phase 3 contract is not acknowledged yet |

## 1. Branch base

The Phase 2 tip is `4ee043f`. Earlier messages cited `064811e`, which was the tip when the closeout was written. The commits after it add the payroll API fix, check scripts and the re-review record.

The hosted Phase 2 run was on `27217c1`. No application code changed from there to `064811e`; only docs, tools and tests did.

## 2. Hosted results on `6bba06b`

Deployment identity: Engineer A promoted this deployment in Vercel. From outside, the behaviour changed as expected (the fields stopped reaching Billing and the policy read returned 11 rows).

| Check | Result |
| --- | --- |
| Payroll API rules, `verify-payroll-credential-access.mjs` | 36/36 |
| Phase 3 reads, `verify-billing-phase3-reads.mjs` | 13/13 |
| Collections-only refusals A3, A4, D8 | 4/4 |
| Payroll fields in real browser sessions, `verify-payroll-fields-ui.mjs` | 13/13 |
| Billing draft flow in a real browser, `verify-billing-draft-ui.mjs` | 6/7 on `6bba06b` (section 3), then 7/7 on `3a3028d` |

Payroll field results by role:

| Role | Fields in API | Fields in UI | Can change them |
| --- | --- | --- | --- |
| Owner/Admin | Yes | Yes | Yes |
| Payroll staff | Yes | Yes | Yes, with client edit. Without it, read only |
| Billing-only, Collections-only | No | Panels unreachable | No, 403 |
| Billing or Collections plus Clients, with client edit | No | Hidden, including the add-client form | No. PATCH is 403. PUT saves other fields and ignores these. Real UI saves carried neither field |
| No modules | 403 | Not applicable | No |
| Anonymous | 401 | Not applicable | No |

The Billing-plus-Clients rows use temporary account changes, because Billing-only staff cannot open a client panel. The add-client form was opened but not submitted. Admin saw the controls in the same form, which confirms the hidden check can see them.

The same API checks failed 26 of 36 on the unfixed route locally, so they do detect the leak.

Sandbox after the runs: 8 `client_services` rows with no credential values, no `PR` service, all three test accounts back to their original modules and edit flag, and the 3 original policy rows. The smoke draft was deleted; its audit rows remain.

## 3. Found and fixed during integration

| Item | Fix |
| --- | --- |
| Invoice detail heading was blank for a draft. `dev`'s restyled heading did not handle a missing number (hosted check B5) | `app/billing/page.tsx` now shows Draft |
| The issue date cell in `dev`'s new list column did not handle a missing date | Shows a dash |
| `tests/billing-phase3-api-contracts.test.mjs` failed at `68c5fc0`, because it still looked for code that commit removed | Assertions updated |

Merge conflicts with `dev` were resolved by keeping the PracticeOps layout and the Phase 2 draft behaviour.

## 4. Open items

For Engineer B, before Engineer A acknowledges the Phase 3 contract:

1. **Policy save refuses the policy read.** `GET /permissions/policy` returns `pricing.manage` with `owner` and `admin`, and `PATCH` allows only `manager`, `staff` and `offshore`. Saving the response unchanged gives `422 INVALID_INPUT`, on the Preview too. Either the read should return delegable roles only, or the contract should say the UI sends only those roles. Screen 4 only.
2. **Stale sentence.** Contract line 92 says acceptance is synthetic "until the real Operations source is identified". The owner has identified it, so this should say what the real-shaped check is and when it runs.
3. **Sandbox migration.** `20261104160000_collections_guard_auto_match_review_state` arrives from `dev`. Please confirm whether it is applied in the sandbox.
4. **Tidy-up, no effect.** In `client-slideover.tsx`, `mayViewPayrollCredentials` was added to the 1099 counts effect rather than the sync effect. It is harmless because the layout waits for the session.

Everything else in `68c5fc0` is accepted: the 11-action effective policy matches what staff actually receive, stored rows and revocations are honoured, and the wording items are applied.

Before production:

- **Database access boundary.** The owner's metadata shows `anon` and `authenticated` grants on the two columns, RLS enabled and no read policies. That suggests direct reads return no rows, but no test has confirmed it on the Operations project.
- **Credential rotation** is on hold by owner decision.
- **Real Operations data.** Every check here used synthetic rows. The Operations project is now identified, but nothing has been run against it.

## 5. Not covered

- The full Phase 2 hosted matrix was not repeated: it needs a new synthetic client and adds permanent rows. The local matrices passed on the integrated code (Phase 1 37/37, Phase 2 89/89), as did the hosted reads, refusals and draft flow.
- Payments and Receivables UI on the merged PracticeOps screens were covered by unit and route tests, not a hosted browser pass.
- A Payroll-staff PIN edit through the UI. It was checked through the API.

## 6. Integration decision

Engineer A chose `codex/billing-dev-integration` as the integration point and merged it into `dev` after the heading fix was confirmed on the Preview. The merge is a fast-forward. The commit after `3a3028d` changes only this record and its results file. The open items in section 4 do not touch `dev` behaviour, and no Phase 3 screen exists yet.

This does not authorize production, and it does not start Phase 3 screen work.
