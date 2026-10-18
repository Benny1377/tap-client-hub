# Collections Phase 4 Backend Handoff

Branch: `codex/collections-phase4-backend` (local, unpushed)
Base: `c9d486f` (`codex/collections-phase3-backend-fixes`)
Contract approval: Owner and Engineer A approval reported by project owner on 2026-10-18. See `docs/contracts/collections-phase-4-ar-pdf-intake.md` and its Phase 3 source-identity addendum.

## Implemented in this branch

- Forward-only migration `20261019100000_collections_pdf_intake.sql`: source-aware attempt/hold/event identities, unique stage attempts by canonical identity, private PDF bucket metadata, import batches/revisions/source-row provenance, aliases, audit data, dynamic role policy, approval separation-of-duties, Billing discrepancy checks, stale-snapshot reblocking, and source-aware hold/event/approval RPCs.
- Authenticated upload/list/review/parse/approve/download/permission/discrepancy-resolution APIs under `/api/collections/imports`.
- Uploads are capped at 25 MB, signature-checked, SHA-256 deduplicated, stored in private `collections-ar-pdfs`, and audited. Signed download links expire after 60 seconds and access is audited. No automatic deletion policy is configured.
- `pdfjs-dist` extracts page-positioned text and recognizes the two approved report labels. Extracted content is retained by page/row; identical rows within a batch are marked as duplicates. Parsing is not treated as approval. Reviewers classify every line and explicitly enter/confirm invoice fields and TAP Hub client linkage. Prior corrected invoice snapshots are retained and returned in review history.
- Worklist and preview merge approved PDF-selected invoices without duplicating linked Billing rows. The source identity fields and discrepancy reason are exposed. Delivery history accepts `source_invoice_id` and displays the source labels.
- Hold, event, and approval routes accept source-aware targets. The existing synthetic Phase 3 test runner is updated to populate canonical identity for Billing attempts; it still consumes Billing-only worklist rows and cannot send PDF imports.
- The local harness enables private Storage, includes the forward migration in `reset.sh`, and adds a Phase 4 schema assertion suite.

## Important limits before UI review/sign-off

- The PDF parser stages extracted text and report metadata; it intentionally does not infer invoice fields. A reviewer must turn a source row into a reviewed invoice. This avoids silently misreading financial columns, but the frontend must present a deliberate mapping/review form.
- Summary/detail cross-check is implemented at `POST /api/collections/imports/{summary_batch_id}/cross-check`. A reviewer confirms the summary total; the API calculates and audits the difference, and a same-date summary batch must match before the detail batch can be approved. Financial values are intentionally not inferred from PDF positions.
- Partial duplicate matching is not automated. Reviewers can explicitly reuse an existing `source_invoice_id`; the backend preserves the previous revision and merges non-conflicting optional fields, while recording the selected balance and the old value in the audit trail.
- The full browser/API upload-to-worklist flow has not been run in this turn. The clean local migration reset and five SQL suites passed; no hosted database was changed.
- This change does not authorize provider-backed or live sends. Phase 3 remains test-only, synthetic-only, and delivery-disabled by default.

## Validation performed

- `npm run typecheck` passes.
- Targeted ESLint on changed TypeScript files passes.
- A generated in-memory synthetic one-page PDF smoke test confirmed text extraction, `aging_detail` classification, and an `2026-08-28` as-of date. The generated file was not saved.
- `bash tools/collections-local/reset.sh --local` and `bash tools/collections-local/test.sh --local` pass on the disposable local Supabase database, including late-link identity sharing, stale Billing re-blocking, and atomic correction/revision/audit checks.
- `node --test tests/collections-phase4-backend-contract.test.mjs` passes (5 checks).
- Whole-repository `npm run lint` is currently not a clean baseline: it reports hundreds of pre-existing errors outside this change. Targeted changed-file lint is clean.

## Local validation sequence after review

From a disposable local environment only:

1. `bash tools/collections-local/reset.sh --local`
2. `bash tools/collections-local/test.sh --local`
3. Start the app and run synthetic-only upload → parse → row classification/correction → approval → worklist/preview → discrepancy resolution checks.
4. Verify private-bucket download access for authorized roles and denial for unassigned/anonymous users. Verify uploader and corrector approval rejection.

Never use the supplied real QuickBooks PDFs as fixtures or move them into Git/shared test environments.
