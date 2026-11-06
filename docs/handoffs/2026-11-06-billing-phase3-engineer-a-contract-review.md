# Billing Phase 3: Engineer A contract review

| Field | Value |
| --- | --- |
| Date | 2026-11-06 |
| From | Engineer A (Billing UI / workbench) |
| To | Engineer B, project owner |
| Reviews | `docs/contracts/billing-phase-3-workbench.md` on `codex/billing-phase3-planning` at `0053410` |
| Against | Frozen Phase 2 contract and routes at `d9cd4a6`, plus read-only calls to the Preview |
| Outcome | **Not acknowledged yet.** Scope and screen order are accepted. Two gaps block screens 3 and 4, one decision affects screen 1, and seven wording changes are requested |

## 1. Accepted

- Scope: no manual payment or reconciliation work, Payments and Receivables unchanged except integration regression fixes, no email/PDF delivery, payment processing, bank feeds or accounting integrations.
- Screen order, and Engineer A and B ownership.
- UI-only normalization of legacy snake_case reads. Moving screen 1 off the `POST /invoices/[id]` adapter to explicit `/issue` and `/void` is correct; the current UI still calls the adapter, and that migration is ours.
- Server-authoritative money, dates, permissions and price resolution. Checked against the routes: candidate fields, bundle `components`, cursor ordering (`name, id`), the `DELETE /invoice-lines` JSON body, `/completion-source-maps` filters, and the absence of a standalone invoice GET all match.

## 2. Blocking gaps

The contract says it needs no new API and that Phase 3 is ready when "each screen's API exists". These two do not exist. Both are small read-only endpoints, so they need owner approval under the "concrete contract gap" rule.

| # | Screen | Gap | Evidence | Requested change |
| --- | --- | --- | --- | --- |
| 1 | 4 Settings | **No way to read the current action policy.** The editor must show each action's `allowedRoles` and `enabled`, and `PATCH` replaces each listed action, so saving without reading could overwrite a delegation. `GET /permissions` returns only the caller's own effective actions | `GET /api/billing/permissions/policy` as Admin on the Preview: `404 NOT_FOUND`. The route handles `PATCH` only | Add `GET /api/billing/permissions/policy` returning `{policies:[{actionKey,allowedRoles,enabled}]}`, gated by `policy.manage` |
| 2 | 3 and 4 | **No Billing endpoint lists a client's services.** Overrides, bundle components, completion maps and manual confirmations all need a `clientServiceId`, and rate entries need a `serviceCode`. `GET /client-pricing` returns only services that already have an override or bundle, and the schedule returns only mapped services, so a service with neither can never be picked. The contract requires `/api/billing/*` only and no exposure of Operations secrets. The only other source is `/api/clients`, which breaks both (section 4) | Read of the routes; `client-pricing` keys are `clientId, overrides, bundles` | Add read-only `GET /api/billing/client-services?clientId=` returning only `id`, `active`, `frequency`, service `code` and `name`, gated by `pricing.view` or `candidates.view`. Rate-entry creation may also need a service-code list |

## 3. Decision needed on screen 1

| # | Gap | Evidence | Options |
| --- | --- | --- | --- |
| 3 | **The invoice read does not say which lines are candidate-linked.** Lines in `GET /invoices` carry no `candidateIds`, and the contract rules out a detail GET. The UI cannot show a line as locked; it would offer Edit and then show a `409` | Line keys on the Preview: `id, amount, period, quantity, created_by, invoice_id, sort_order, updated_by, description, unit_amount, client_service_id` | Recommended: add `candidateIds` to lines in the read, which is additive to the legacy shape. Otherwise record that Edit stays visible and the conflict is explained after the `409` |

## 4. Separate security issue, not a Phase 3 item

**`GET /api/clients` returns `payrollPassword` and `eftps` to anyone with any module.** The route only refuses a user with no modules. On the Preview, Billing-only and Collections-only staff both received those fields for every client service; unassigned staff received 403. The synthetic rows hold no real values, and only field names were inspected. The route also returns other client fields such as EIN.

The Billing UI uses `/api/clients?fields=lite` for its client picker, so this review did not depend on it. This is existing code outside Billing, and it needs its own fix and owner decision. Please check whether real data is reachable the same way.

## 5. Wording changes requested

No API change needed for these.

| # | Contract text | Actual behaviour | Requested wording |
| --- | --- | --- | --- |
| 4 | Generation refreshes "using the returned IDs and refresh targets" | `POST /candidates/generate` returns no `refresh`, and `candidateIds` holds new rows only (empty on a re-run). The frozen example agrees | After generate, always refetch candidates and invoices |
| 5 | Screen 2 supports client and date filters | `schedule` and `generate` need a `clientId` or service scope, otherwise 422. "All clients" is the page default | A client must be selected. There is no all-clients projection |
| 6 | Remittance "reads/writes" | `PATCH` is a full replace: an omitted field becomes null, and a null value is refused | The UI always sends all three fields |
| 7 | On `422`, "identify the invalid field using the stable code" | `INVALID_INPUT` is one generic code with no field name | Show the server's `error` text. Field-level detail comes from client validation |
| 8 | "Treat a duplicate response as an existing confirmation" | Two different cases: `200 created:false` is a replay; `409 DUPLICATE_RESOURCE` is a conflict (another key, or changed data) | Treat `200` as existing. Show `409` as a conflict, not a success |
| 9 | Bundle "must never be summed" | Candidates carry no bundle id, and each component shows the full package price. Drafting one component alone is refused | Group by `client-pricing` bundle `components` plus candidate date, and select the group as a whole |
| 10 | "On `403`, refresh permissions" | Collections-only staff get 403 from `/permissions` itself but can read `/invoices`, so refreshing never helps them | State what Collections-only sees: read-only invoices, no candidate or pricing panels. A 403 from `/permissions` means no Billing actions, not an error. Also state that `/invoices` stays readable after `billing.view` is revoked, or ask for that to change |

`PATCH /invoices/[id]` should also be described as memo-only, which is what it accepts since `b630f2a`.

## 6. Acceptance evidence concern

The sandbox holds no real Operations rows (see the Phase 2 closeout). Items 3 and 6 of the contract's acceptance evidence can only run on synthetic data there. Please either identify the database holding the reported rows or state in the contract that Phase 3 acceptance is synthetic, with a real-shaped check required before production.

## 7. Position

Engineer A will acknowledge once:

1. The owner approves gaps 1 and 2, and they are added to the contract and built.
2. Item 3 is decided.
3. Items 4 to 10 are reflected in the contract.

Screen 1 could start before gaps 1 and 2 land, because it needs neither. That is the owner's call and would need the contract to say so. No screen work starts before acknowledgement by both engineers and the owner.
