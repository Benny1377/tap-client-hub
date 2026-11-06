import test from "node:test";
import assert from "node:assert/strict";
import { normalizeImportedCustomerName, suggestCollectionsPdfRows } from "../lib/collections-pdf-suggestions.ts";

test("recognized QuickBooks detail layout extracts only complete invoice rows by PDF column position", () => {
  const lines = [
    { page: 1, text: "Type | Date | Num | Name | Terms | P.O. # | Due Date | Aging | Open Balance", cells: ["Type", "Date", "Num", "Name", "Terms", "P.O. #", "Due Date", "Aging", "Open Balance"], cell_positions: [10, 60, 100, 160, 220, 280, 340, 400, 470] },
    { page: 1, text: "Invoice | 08/01/2026 | INV-1001 | Example Orchard LLC | Net 15 | 08/16/2026 | 27 | $1,250.00", cells: ["Invoice", "08/01/2026", "INV-1001", "Example Orchard LLC", "Net 15", "08/16/2026", "27", "$1,250.00"], cell_positions: [12, 63, 105, 165, 226, 342, 407, 478] },
    { page: 1, text: "Invoice | INV-1002", cells: ["Invoice", "INV-1002"] },
    { page: 1, text: "Total Open Balance | $1,250.00", cells: ["Total Open Balance", "$1,250.00"] },
  ];
  const [header, invoice, incomplete, total] = suggestCollectionsPdfRows(lines);
  assert.equal(header.disposition, "header");
  assert.equal(invoice.disposition, "invoice");
  assert.deepEqual(invoice.fields, {
    transaction_type: "Invoice", transaction_date: "2026-08-01", invoice_number: "INV-1001",
    customer_name: "Example Orchard LLC", terms: "Net 15", po_number: null,
    due_date: "2026-08-16", reported_aging: 27, open_balance: "1250.00",
  });
  assert.equal(incomplete.disposition, "unreviewed");
  assert.equal(total.disposition, "summary");
});

test("customer normalization is exact after harmless punctuation and legal suffix normalization", () => {
  assert.equal(normalizeImportedCustomerName("Example Orchard, LLC"), normalizeImportedCustomerName("Example Orchard"));
  assert.notEqual(normalizeImportedCustomerName("Example Orchard North"), normalizeImportedCustomerName("Example Orchard South"));
});
