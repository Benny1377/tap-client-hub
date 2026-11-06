# Billing Phase 3 review resolution

Status: owner-approved contract revision and producer implementation are local on `codex/billing-phase3-contract-apis`; awaiting Engineer A acknowledgement. No UI has been started, and nothing is deployed.

## Accepted API decisions

1. Add `GET /api/billing/permissions/policy`, Owner/Admin-only through `policy.manage`. It returns the current fixed-key policy as `{policies:[{actionKey,allowedRoles,enabled}]}` so the editor can load existing settings before saving.
2. Add read-only `GET /api/billing/client-services?clientId=<UUID>`, requiring either `pricing.view` or `candidates.view`. Its projection is exactly `id`, `active`, `frequency`, `serviceCode`, and `serviceName`; it does not expose Operations-only or credential fields.
3. Add active provenance `candidateIds` to invoice lines returned by the existing legacy invoice list. Preserve its Phase 1 snake_case fields and omit the raw link-table payload.

## Accepted interaction and scope clarifications

- After candidate generation, refetch candidates and invoices. The response's `candidateIds` identifies newly created rows only; it is not a refresh list.
- Projection and generation require an explicit client or client-service scope. Never run an all-client projection or generation.
- Remittance PATCH is full replacement and must send all three fields.
- `INVALID_INPUT` is generic; client validation places field errors, while server error text is shown as the summary.
- Manual-confirmation `200 created:false` is an idempotent replay; `409 DUPLICATE_RESOURCE` is a conflicting confirmation.
- A bundle candidate amount is the full package price on each component candidate; the UI groups by client bundle and candidate date and selects the group as a unit.
- Collections-only continues to read invoices but receives no Billing candidate/pricing panes or `/permissions` response. Invoice-list access remains even when `billing.view` is disabled.
- Houston business dates use `America/Chicago`; acceptance is synthetic until the real Operations source is identified, with a real-shaped compatibility check required before production.
- No manual payment, reconciliation, A/R import, production rollout, or live integration scope is added.

## Local implementation and validation

- API implementation is in `app/api/billing/[...path]/route.ts` and `app/api/billing/invoices/route.ts`.
- The four focused contract tests pass with `node --test tests/billing-phase3-api-contracts.test.mjs`.
- Targeted ESLint passes for the changed Billing route files and test.
- Full typecheck reaches only the existing unrelated `lib/collections-pdf-parser.ts` `pdfjs-dist/legacy/build/pdf.mjs` resolution error.
- Engineer A should review these exact shapes, acknowledge the amended contract, and add them to the Preview matrix before Phase 3 UI work starts.
