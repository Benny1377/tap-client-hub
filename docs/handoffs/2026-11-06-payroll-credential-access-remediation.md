# Payroll credential access remediation

Status: implemented locally on `codex/client-payroll-data-access`; not committed, pushed, or deployed.

## Finding and boundary

The prior `GET /api/clients` response serialized `payrollPassword` and `eftps` for any authenticated caller with at least one module. The route uses a service-role client, so database RLS does not narrow this response. Engineer A observed the field names on the isolated TAB-HUB Preview using synthetic data; no credential values were inspected here, and this work did not query a hosted database. The code path is shared, so the same exposure was possible for real records when present. This is a confirmed code-level authorization defect, not independently verified real-data access.

## Implemented rule

- Owner/Admin and users assigned the Payroll module may receive and edit the two credential fields.
- Other module users never receive those keys in `/api/clients` JSON.
- Broad `PUT /api/clients` saves strip `payrollPassword` and `eftps` for non-Payroll callers, preventing both replacement and clearing while preserving unrelated client/service edits.
- Direct `PATCH /api/clients` requests that include either credential field return 403 before a database update.
- The authorization decision is server-side and based on the resolved profile modules/role; UI hiding is not relied upon.

## Validation and deployment

- `node --test tests/security-hardening.test.mjs`: 14/14 pass, including role matrix and route guard assertions.
- Targeted ESLint matches the branch-HEAD baseline exactly (52 errors, 2 warnings across unrelated legacy code); the credential guard adds no lint findings.
- Full TypeScript check is blocked by the existing `lib/collections-pdf-parser.ts` unresolved `pdfjs-dist/legacy/build/pdf.mjs` import.
- No hosted records were queried or changed. Engineer A/Owner should deploy this branch to the isolated Preview and verify Billing/Collections cannot see either key, Payroll and Owner/Admin can, and unauthorized PATCH/PUT cannot change stored values before considering the fix released.
- Rotate any actual payroll/EFTPS credentials only if the Operations owner determines they were exposed; this implementation does not itself access or rotate secrets.
