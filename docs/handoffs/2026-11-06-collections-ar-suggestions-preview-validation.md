# Collections A/R client suggestions: Engineer A Preview validation

| Field | Value |
| --- | --- |
| Date | 2026-11-06 |
| From | Engineer A |
| To | Engineer B |
| Deployment | `https://tap-client-hub-test.vercel.app` |
| Deployed commit | `233f2ab` on `codex/collections-ar-preview`: `dev` at `999029b` merged with `b2d614c` |
| Database | TAB-HUB sandbox, `vuqgxotdccxivjmavsoj.supabase.co` |
| Outcome | **Safety rules pass. Candidates on the real report are blocked:** the sandbox has one client, so the existing batch showed 0 candidates |

Report content is restricted, so this record holds counts and statuses only.

## Deployment

The Vercel project is connected to the fork `AananChopra/tap-client-hub-test`, not to the main repository. `b2d614c` is 38 commits behind `dev`, so deploying it alone would have removed Phase 2, Phase 3 and the payroll fix from the Preview. It was merged with `dev` on a preview branch instead. It is not merged to `dev`.

The commit is inferred from outside: the served code contains the candidate text and parser v2, and the `dev` fixes still behave. Engineer A promoted the deployment in Vercel.

Delivery stayed off: mode `disabled`, automation off, 0 delivery attempts and 0 events, before and after.

## Existing batch `a8dc99de`, refreshed through the UI as Collections staff

| | Before (v1) | After (v2) |
| --- | --- | --- |
| Rows | 909 | 909 |
| Invoice suggestions, high confidence | 411 | 394 |
| Uncertain, needs review | 250 | 74 |
| Header suggestions | 1 | 195 |
| Rows awaiting review | 661 | 468 |

- All 248 rows with an existing decision were unchanged.
- No row was linked or staged, the batch stayed `needs_review`, and nothing was approved.
- The 17 fewer invoice suggestions are invoice rows with cut-off customer names and no heading on their page. They moved to needs review, which is the safer result. No invoice suggestion now has a cut-off name.
- Labels read "Suggested fields" and "Needs review". Client candidates shown: **0**, because the only sandbox client is synthetic.

Check script: `tools/billing-preview/verify-ar-suggestions-refresh.mjs`, 7/7. The summary batch `c9c65d41` was not refreshed.

## Confirmation and approval, on a tagged synthetic batch

The real report was not used, because mapping a real customer to the synthetic client would be a false match. Check script: `tools/billing-preview/verify-ar-confirmation-synthetic.mjs`, 13/13.

- The candidate shows with the label "ranked by name similarity; verify before saving".
- The form prefills the client, says it is not a link until confirmed, and leaves confirmation unticked. Opening it writes nothing, and saving unticked is blocked.
- Confirming stages one review entry. The batch stays `needs_review`, and the invoice does not appear in `/api/collections/receivables`.
- Approval refused: the reviewer who confirmed (403), the uploader as Admin (409), and an Admin who classified a line (409). The batch was never approved. No approval was attempted on a real batch.

Not proven: that the invoice does appear in the pipeline after a valid approval, because approval was out of scope.

## Left in the sandbox

Synthetic batch `7280e321` could not be fully removed, so it is closed as `rejected`. Its 3 rows and 1 source invoice identity remain, along with audit rows. Its staged invoice was deleted. The real batch `a8dc99de` now carries the v2 suggestions, 193 more automatic header labels and new audit rows.

## For Engineer B

1. **Blocked:** load real-shaped clients into the sandbox, or say how candidates on the real report should be checked.
2. **Refresh failure, found by reading the code, not tested:** in the parse route, a PDF extraction failure during a refresh sets the batch to `failed`. A later parse of a `failed` batch deletes and rebuilds all rows, which would lose reviewer decisions. A failed refresh should leave the batch in `needs_review`.
3. Decide when `b2d614c` goes to `dev`. It merges cleanly.
