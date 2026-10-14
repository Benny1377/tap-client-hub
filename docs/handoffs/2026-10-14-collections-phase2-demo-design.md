# Handoff: Collections Phase 2 UI in the owner demo (v14) design (Engineer A)

| Field | Value |
| --- | --- |
| Date | 2026-10-14 |
| Branch | `codex/collections-phase2-demo-design` |
| Base | `codex/collections-phase2-ui-validation` at `dd3472f` (contains backend integration `53324a7`) |
| Scope | **Phase 2.** Visual and layout rework of the Billing and Collections screens to match the owner-provided `TAP_Client_Hub_Demo_v14.html`. No API, database, permission, or contract change. Automation and delivery stay off. |
| Merge order | Backend integration `53324a7`, then UI `dd3472f`, then this branch. Independent of `codex/collections-phase3-contract`; the S1 and harness fixes there touch no files changed here. |

## What changed

The demo file itself is not committed; it stays outside Git per the playbook.

- **Collections:** the demo's tabbed layout, all fed by the existing API. Every tab stays mounted (only hidden), so form drafts and preview results survive switching.
  - **AR Insights:**
    - a source strip;
    - four metric tiles from the server summary;
    - an aging bar;
    - an accounts card;
    - the ranked call list ("The accounts that need you now").
  - **Pipeline:**
    - an outstanding-balance banner;
    - "Needs your decision" (approvals, and approved notices still to record as sent);
    - five touch cards that open the stored template wording;
    - money-by-stage bars;
    - "Who's where";
    - the automation preview.
  - **Setup & rules:**
    - per-touch ladder settings (Owner/Admin);
    - email templates with merge fields;
    - guardrails;
    - a locked "Sender & routing" card;
    - the "On hold — never chased" list.
  - **Activity:** the history and the log-activity form. The demo has no equivalent, so this tab is added.
- **Billing:** same tokens, cards, tables, badges, and buttons; layout unchanged.
- **Styling:**
  - Shared `bc-*` classes are in `app/globals.css`. They reuse the demo palette already defined there and add `--faint`, `--line2`, `--navy`, and `--navy-soft`.
  - Shared form, button, and table styles live in `components/billing/ui.tsx`.

## Deliberate differences from the demo

- Text about QuickBooks, an AI agent, or sending email now describes current behavior: balances come from TAP Hub Billing, and nothing is sent.
- The demo's narrative insight cards are omitted. They need firm-wide aggregates the API does not provide; the call list is paginated.
- Money-by-stage and "Who's where" cover the current call-list page and say so when more accounts exist.
- Sender, reply-to, and test recipient appear as a locked card until the Phase 3 integration.

## Validation

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS |
| ESLint on changed files | PASS. Full repo is unchanged from base: 582 outside the local-only `dev-mock/`, 0 in changed files. |
| `npm run build` | PASS |
| `node tests/billing-ui-data.test.mjs` / `node tests/billing-ui-render.test.mjs` | PASS 42 / PASS 58. Five new checks cover the tabs, ladder touches, money by stage, "Who's where", and the split decisions/activity panels. Three checks were updated from old inline-style markup to the new classes with the same intent. |
| Browser, local synthetic harness (Owner) | Every tab at 1360 px and 375 px, with no horizontal page scroll. Saving rules from Setup shows "Rules saved" and updates the Pipeline touch cards immediately. Labels restored afterward. |

## Follow-ups

- Optional: firm-wide insight aggregates (concentration, chronic accounts) if the producer adds them to the receivables summary. `summary.chronic_accounts` already exists.
