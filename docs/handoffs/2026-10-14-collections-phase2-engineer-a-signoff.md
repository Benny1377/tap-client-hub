# Sign-off: Collections Phase 1 and Phase 2, consumer side (Engineer A)

| Field | Value |
| --- | --- |
| Date | 2026-10-14 |
| Signer | Engineer A (UI and integrated testing) |
| Decision | **Phase 1 and Phase 2 accepted from the consumer side, with the release conditions below.** |
| Scope | Billing ledger UI (Phase 1), Collections worklist, ladder, approvals, holds, rules, and preview UI (Phase 2), and the demo v14 visual pass. No QuickBooks, email delivery, or hosted change. |

## What is being signed off

| Branch | Head | Role | Merge order |
| --- | --- | --- | --- |
| `codex/collections-phase2-integration` | `53324a7` | Phase 1/2 backend (Engineer B) | 1 |
| `codex/collections-phase2-ui-validation` | `dd3472f` | Phase 1/2 UI, harness tools, validation records | 2 |
| `codex/collections-phase2-demo-design` | this commit | Demo v14 design for Billing/Collections, plus the sign-in redirect fix | 3 |

The S1 and H4/H5/H6 fixes on `codex/collections-phase3-contract` (`cc862c4`) must reach the Phase 2 line before release (condition 1). They touch no file changed on the UI branches.

## Evidence

All runs used the local synthetic Supabase harness only. Automation stayed off, delivery stayed `disabled`, and there were 0 delivery attempts.

| Run | Result | Record |
| --- | --- | --- |
| Backend `3bec72a`, first integrated pass | PASS: SQL suites, 48/48 API/DB/audit, Owner and staff browser flows | `docs/handoffs/2026-10-11-collections-phase2-ui-validation.md` |
| Backend `53324a7` rerun | PASS: 5 SQL suites, 68/68 API/DB/audit, browser (rules editor, firm timezone, early higher stage, contact pause) | Same handoff, "Integrated rerun" section |
| `cc862c4`, no workaround | PASS: clean reset, 5 SQL suites, 68/68; H4/H5/H6 confirmed; Contacts browser and primary-contact audit; S1 access matrix 12/12 | Engineer A report, 2026-10-14 |
| This branch | PASS: `tsc`, UI data 42/42, UI render 60/60, access-policy regression, `npm run build`; ESLint clean on all changed files; `app/layout.tsx` keeps its 2 pre-existing findings | This commit |

## Sign-in redirect fix (included here)

After signing in, the layout moved from `/login` into the app before `/api/me` answered. The access redirect then ran on the default (staff, no modules) and sent every user to the fallback `/time`. The redirect now waits for the identity to load.

Verified through the real login form: Owner lands on Clients, and Collections staff land on Collections.

## Release conditions (open)

1. **S1 into the Phase 2 line (Engineer B):** bring the validated S1 (`GET /api/contacts` auth) and H4/H5/H6 changes from `cc862c4` into the Phase 2 integration line, then rerun the 68-check suite and the S1 matrix once on the merged result.
2. **Joint review, then merge in the order above.** Nothing goes to `main` before sign-off.
3. **Hosted migrations stay deferred** until release approval; no hosted test project is available yet.
4. **Owner security actions:** COL-DEP-10 (rotate the exposed shared password) and COL-DEP-12 (review the historical credential-bearing migration).

## Known, non-blocking

- **A3:** stage 4–5 preview reports an ambiguous primary contact as `email_contact_missing`. The UI label was clarified; the API code is still open.
- **A4:** settings money serializes as `"50"`, not `"50.00"`.
- **Visual follow-up:** an app-wide shell restyle to demo v14 (sidebar, header, sidebar client picker) exists on local branch `codex/app-shell-demo-v14`. It is deliberately outside Phase 2 and will come back for owner/Engineer B review.
- **Source-of-truth change:** the owner's new direction to take in QuickBooks AR PDF reports changes Phase 2's "Billing is the only receivables source" assumption. It needs its own contract change; Phase 2 ships as validated, reading Billing.
