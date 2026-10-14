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
| `codex/collections-phase2-integration` | `8ba6897` | Phase 1/2 backend (Engineer B), now including the S1 and H4/H5/H6 port | 1 |
| `codex/collections-phase2-ui-validation` | `dd3472f` | Phase 1/2 UI, harness tools, validation records | 2 |
| `codex/collections-phase2-demo-design` | this commit | Demo v14 design for Billing/Collections, plus the sign-in redirect fix | 3 |

The S1 and H4/H5/H6 fixes were ported from `cc862c4` to the Phase 2 backend at `8ba6897`; the code is byte-identical to what was validated on `cc862c4`. The design branch and `8ba6897` merge without conflicts.

## Evidence

All runs used the local synthetic Supabase harness only. Automation stayed off, delivery stayed `disabled`, and there were 0 delivery attempts.

| Run | Result | Record |
| --- | --- | --- |
| Backend `3bec72a`, first integrated pass | PASS: SQL suites, 48/48 API/DB/audit, Owner and staff browser flows | `docs/handoffs/2026-10-11-collections-phase2-ui-validation.md` |
| Backend `53324a7` rerun | PASS: 5 SQL suites, 68/68 API/DB/audit, browser (rules editor, firm timezone, early higher stage, contact pause) | Same handoff, "Integrated rerun" section |
| `cc862c4`, no workaround | PASS: clean reset, 5 SQL suites, 68/68; H4/H5/H6 confirmed; Contacts browser and primary-contact audit; S1 access matrix 12/12 | Engineer A report, 2026-10-14 |
| **Final merged Phase 2** (design branch `298b813` merged with backend `8ba6897`; local only) | **PASS:** clean reset; 5 SQL suites; H4/H5/H6 present (fixture ages 40 and 15 days); **68/68 API/DB/audit with no workaround**; **S1 matrix 12/12**; `tsc`; UI data 42/42 and render 60/60; Phase 1/2 contract, contacts, route-access, access-policy, and support suites; `npm run build`; ESLint clean on changed files. Browser: login form → Owner lands on Clients, Contacts loads (3 contacts), Collections shows the three demo views and six insight cards. | Engineer A, 2026-10-14 |
| This branch before the port | PASS: `tsc`, UI data 42/42, UI render 60/60, access-policy regression, `npm run build`; ESLint clean on all changed files; `app/layout.tsx` keeps its 2 pre-existing findings | This commit |

## Sign-in redirect fix (included here)

After signing in, the layout moved from `/login` into the app before `/api/me` answered. The access redirect then ran on the default (staff, no modules) and sent every user to the fallback `/time`. The redirect now waits for the identity to load.

Verified through the real login form: Owner lands on Clients, and Collections staff land on Collections.

## Release conditions

1. ~~S1 into the Phase 2 line~~ **Done:** ported at `8ba6897`, and the final merged rerun above passed.
2. **Open: joint review, then merge in the order above** (`8ba6897` → `dd3472f` → this branch). Nothing goes to `main` before sign-off.
3. **Open: hosted migrations stay deferred** until release approval; no hosted test project is available yet.
4. **Open: owner security actions:** COL-DEP-10 (rotate the exposed shared password) and COL-DEP-12 (review the historical credential-bearing migration).

## Known, non-blocking

- **A3:** stage 4–5 preview reports an ambiguous primary contact as `email_contact_missing`. The UI label was clarified; the API code is still open.
- **A4:** settings money serializes as `"50"`, not `"50.00"`.
- **Visual follow-up:** an app-wide shell restyle to demo v14 (sidebar, header, sidebar client picker) exists on local branch `codex/app-shell-demo-v14`. It is deliberately outside Phase 2 and will come back for owner/Engineer B review.
- **Source-of-truth change:** the owner's new direction to take in QuickBooks AR PDF reports changes Phase 2's "Billing is the only receivables source" assumption. It needs its own contract change; Phase 2 ships as validated, reading Billing.
