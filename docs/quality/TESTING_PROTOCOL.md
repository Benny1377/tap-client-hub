# TAP Client Hub Testing Protocol

Choose checks based on risk and record the command, commit, environment, result, and limitation.

## Minimum checks

| Change | Required evidence |
| --- | --- |
| UI-only | Clean diff, focused lint where meaningful, responsive manual review |
| Shared worklist | Review all affected service variants, horizontal scrolling, current-month behavior, and mobile layout |
| API or access | Focused route or policy tests, authenticated and forbidden-path checks |
| Persistence | UI input, API response, database row, reload, and cleanup or rollback behavior |
| Support integration | `npm run test:support` and the focused API contract test |
| Release | Relevant focused tests, `npm run lint`, `npx tsc --noEmit`, `npm run build`, deployment smoke test |

If generated `.next` types are stale or conflicting, record the check as `BLOCKED`; do not label it an application failure without regenerating the approved build artifacts.

Do not claim a production fix until an authorized live validation has passed.
