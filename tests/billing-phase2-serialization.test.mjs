import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const api = loadTs("lib/billing-phase2.ts");

test("Phase 2 money fields serialize as fixed two-decimal strings", () => {
  assert.deepEqual(api.toCamel({ unit_amount: "12.5", amount: 2, other_count: 2 }), {
    unitAmount: "12.50", amount: "2.00", otherCount: 2,
  });
});

test("candidate source is a canonical nested object", () => {
  assert.deepEqual(api.toPhase2Candidate({
    id: "candidate-1", source_adapter: "schedule", source_identity: "service-1:2026-11", unit_amount: "125",
  }), {
    id: "candidate-1", unitAmount: "125.00", source: { adapter: "schedule", identity: "service-1:2026-11" },
  });
});

test("invoice serializer emits camelCase lines, decimal quantities, and active provenance", () => {
  assert.deepEqual(api.toPhase2Invoice({
    id: "invoice-1", invoice_number: null, invoice_lines: [{
      id: "line-1", quantity: "1.2", unit_amount: "10", amount: "12",
      billing_candidate_line_links: [{ candidate_id: "candidate-1", active: true }, { candidate_id: "candidate-2", active: false }],
    }],
  }), {
    id: "invoice-1", invoiceNumber: null,
    lines: [{ id: "line-1", quantity: "1.2000", unitAmount: "10.00", amount: "12.00", candidateIds: ["candidate-1"] }],
  });
});
