# Billing Phase 3: Engineer A contract re-review

| Field | Value |
| --- | --- |
| Date | 2026-11-06 |
| From | Engineer A (Billing UI / workbench) |
| To | Engineer B, project owner |
| Reviews | `codex/billing-phase3-contract-apis` at `f499715` |
| Follows | `2026-11-06-billing-phase3-engineer-a-contract-review.md` |
| Outcome | **Not acknowledged yet.** The endpoint shapes are accepted, except one gap in the policy read. Four stale sentences remain in the contract. No Phase 3 screen work has started |

## 1. What was tested

`f499715` was merged locally with the Phase 2 branch and run on the disposable local stack. It was not deployed.

| Check | Result |
| --- | --- |
| Phase 3 contract tests | 4/4 |
| Phase 1 route matrix | 37/37 |
| Phase 2 route matrix | 89/89 |
| `tsc` | Pass here. The `pdfjs-dist` error Engineer B reports does not occur in this checkout |
| Read checks, `tools/billing-preview/verify-billing-phase3-reads.mjs` | 11/11 |

The read checks cover:

- `GET /permissions/policy`: Admin 200 with the exact shape, and it matches the stored rows. Billing, Collections and unassigned get 403; anon gets 401. The reads changed nothing.
- `GET /client-services`: Billing 200 with exactly the five fields. Collections and unassigned get 403; anon gets 401. A bad or missing id gets 422, and an unknown client returns an empty list.
- `GET /invoices`: every line has `candidateIds`, and the link payload is not exposed. All legacy line fields remain. `candidateIds` equals the active links, with inactive links excluded (6 links, 3 active, including a bundle line with two candidates).

## 2. Resolved from the first review

- Gap 2, client services: resolved.
- Decision 3, `candidateIds`: resolved as recommended.
- Acceptance evidence: the contract now states acceptance is synthetic, with a real-shaped check before production.
- Items 5, 6, 7 and 10: resolved in the new clarifications section. Items 4, 8 and 9 are clarified there too, but see section 4.

## 3. Remaining gap: the policy read is not the full policy

Gap 1 is only partly resolved. The contract says the read "returns the current full policy" (acceptance item 7), and its example shows a `billing.view` row. The endpoint returns only stored rows.

- The sandbox baseline stores 3 rows. Local after the matrix stored 4: `candidates.manage`, `pricing.manage`, `settings.remittance.manage`, `settings.terms.manage`.
- There are 14 Billing actions, of which 11 can be delegated. A delegable action with no row falls back to code: `STAFF_DEFAULTS` in `lib/billing-access.ts` grants staff 8 actions by default.
- So the editor cannot show the state of `billing.view`, `invoices.issue` and the others. Showing them as off would be wrong, because staff have them. Hard-coding the defaults in the UI would copy a server rule the contract says stays on the server.

Requested, either:

1. **Recommended:** return all 11 delegable actions with their effective `allowedRoles` and `enabled`, adding `source: "stored" | "default"` if useful; or
2. Keep the row-only read and publish the defaults in the same response, stating that a missing row means the default applies.

This blocks screen 4 only.

## 4. Remaining wording

The new clarifications are right, but the old sentences they replace are still in the contract, so it now contradicts itself.

| Line | Stale text | Conflicts with |
| --- | --- | --- |
| 54 | Generation refreshes "using the returned IDs and refresh targets" | "After candidate generation, refetch candidates and invoices" |
| 79 | "Treat a duplicate response as an existing confirmation" | `200 created:false` is a replay, `409` is a conflict |
| 96 | On `422`, "identify the invalid field using the stable code" | `INVALID_INPUT` is generic |
| 96 | On `403`, "refresh permissions" | `/permissions` itself returns 403 to Collections-only |

Also from the first review: `PATCH /invoices/[id]` is still not described as memo-only.

Line 98 ("Use server-returned refresh targets") is fine if it says "where the response includes them".

## 5. Noted, no change requested

- Collections-only staff now receive `candidateIds` on invoice lines. They are opaque ids, and candidate reads stay 403. Acceptable.
- `client-services` includes inactive services and sorts by `id`. The UI will filter on `active` and sort by name.

## 6. Position

Engineer A will acknowledge once section 3 is decided and section 4 is applied. Both are small. The Phase 3 branch also needs merging with the Phase 2 branch: `docs/handoffs/README.md` conflicts, but only as two added lines.

Screen 1 needs nothing in section 3, so the owner could allow it to start first, as noted in the first review.
