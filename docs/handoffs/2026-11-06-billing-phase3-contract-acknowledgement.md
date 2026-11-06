# Billing Phase 3: Engineer A contract acknowledgement

| Field | Value |
| --- | --- |
| Date | 2026-11-06 |
| From | Engineer A (Billing UI / workbench) |
| To | Engineer B, project owner |
| Reviews | `codex/billing-phase3-post-integration-fixes` at `fcc2196`, based on `dev` at `166eb6e` |
| Follows | `2026-11-06-billing-phase3-engineer-a-contract-rereview.md`, `2026-11-06-billing-integration-preview-validation.md` |
| Outcome | **Contract accepted at `fcc2196`, with one word to correct in an example (section 2).** `fcc2196` is not merged or deployed. The sandbox migration mirror is not reconciled, because remote history could not be read (section 4) |

## 1. Tested locally on `fcc2196`

| Check | Result |
| --- | --- |
| Phase 1 / Phase 2 route matrices | 37/37, 89/89 |
| Unit tests | 141/141 |
| SQL checks, `tsc` | Pass |
| Payroll fields in real browser sessions | 13/13 |
| Billing draft flow in a real browser | 7/7 |
| Phase 3 reads with the policy save | 16/16 |
| Payroll API rules | 35/36. The miss is the known local fixture: "unassigned" has Timesheet locally. It passed 36/36 on the Preview at `6bba06b` |

The policy save was run for real, on the disposable local database only:

- The GET response saved unchanged returns 200 and reads back the same.
- Billing staff keep the same 8 actions after the save.
- Admin can still create a rate card with `pricing.manage` showing an empty role list, and staff stay refused. The database check also returns early for Owner/Admin, so an empty list cannot lock them out.

## 2. Contract review

Accepted: the delegable-only policy read, the round-trip rule, the read-only Operations check on line 92, and keeping it after Preview acceptance and before production.

One correction: the example shows `pricing.manage` with `"enabled":false`. The real response is `"enabled":true`, because the stored row is enabled, and Engineer B's own test asserts that. Please change that word.

Also accepted: the `client-slideover.tsx` cleanup. The access dependency is now on the sync effect, and the browser checks still pass.

## 3. Hosted status

The Preview runs `3a3028d`. The hosted evidence in the integration record stands, and a recheck today confirms Billing staff still do not receive the payroll fields and the policy read returns 11 rows.

**`fcc2196` has not been deployed**, so the policy round trip and the delegable-only response are proven locally only. On `3a3028d` the Preview still returns `owner` and `admin` on `pricing.manage`.

## 4. Sandbox migration history

Correction to the follow-up handoff: Engineer A's report did not say this migration was in the sandbox history. It said Engineer A did not know and asked Engineer B to confirm.

**Remote history was not verified.** The CLI needs a Supabase login, which this environment does not have, and `supabase_migrations` is not exposed through the REST API.

What was checked:

- The objects from `20261104160000` exist in the sandbox: `review_unreviewed_collection_import_invoice` and `auto_match_collection_import_rows`, the latter with the expected signature. This shows the objects exist, not what the history table says.
- The Phase 2 objects exist too.

**The drift is four files, not one.** `tools/sandbox/supabase/migrations` holds only the two baseline files, and no branch has ever had more. These are missing from it:

- `20261104160000_collections_guard_auto_match_review_state.sql`
- `20261105100000_billing_phase2_core.sql`
- `20261105110000_billing_manual_confirmation_guard.sql`
- `20261106100000_billing_rpc_auth_and_candidate_audit_id.sql`

The mirror was left unchanged. Adding a file the history does not record would make the next `db push` try to run it again, so the list must come first. Read-only query for someone with dashboard access:

```sql
select version, name from supabase_migrations.schema_migrations order by version;
```

Once the list is available, copy exactly the recorded versions from `supabase/migrations`, unchanged. Nothing is pushed.

## 5. Gates that remain

Before Phase 3 screen work:

- The example correction in section 2.
- Owner acknowledgement. Engineer B's acknowledgement should also be on record.

Before production:

- Database access-boundary review for `payroll_password` and `eftps`.
- The read-only real-Operations compatibility check.
- Credential rotation stays on hold by owner decision.
