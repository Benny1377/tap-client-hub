import test from "node:test";
import assert from "node:assert/strict";
import { normalizeImportedCustomerName, suggestCollectionsPdfRows, suggestCollectionsSummaryRows } from "../lib/collections-pdf-suggestions.ts";

test("recognized A/R summary rows retain customer aging totals for detail matching", () => {
  const [reportTitle, customer, reportTotal, header, unreadable] = suggestCollectionsSummaryRows([
    { page: 1, text: "A/R Aging Summary", cells: ["A/R Aging Summary"] },
    { page: 1, text: "Example Orchard LLC | 10.00 | 20.00 | 30.00 | 40.00 | 50.00 | 150.00", cells: ["Example Orchard LLC", "10.00", "20.00", "30.00", "40.00", "50.00", "150.00"] },
    { page: 1, text: "TOTAL | 10.00 | 20.00 | 30.00 | 40.00 | 50.00 | 150.00", cells: ["TOTAL", "10.00", "20.00", "30.00", "40.00", "50.00", "150.00"] },
    { page: 1, text: "Customer | Current | 1-30 | 31-60 | 61-90 | Over 90 | Total", cells: ["Customer", "Current", "1-30", "31-60", "61-90", "Over 90", "Total"] },
    { page: 1, text: "Malformed customer row", cells: ["Malformed customer row"] },
  ]);
  assert.equal(reportTitle.disposition, "header");
  assert.equal(customer.disposition, "summary");
  assert.equal(customer.fields?.kind, "customer");
  assert.equal(customer.fields?.total_open_balance, "150.00");
  assert.equal(reportTotal.fields?.kind, "grand_total");
  assert.equal(header.disposition, "header");
  assert.equal(unreadable.disposition, "unreviewed");
});

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

test("detail group headings complete abbreviated invoice names and non-invoice transactions stay evidence", () => {
  const lines = [
    { page: 1, text: "Type | Date | Num | P. O. # | Name | Terms | Due Date | Aging | Open Balance", cells: ["Type", "Date", "Num", "P. O. #", "Name", "Terms", "Due Date", "Aging", "Open Balance"], cell_positions: [10, 60, 100, 150, 210, 270, 330, 390, 460] },
    { page: 1, text: "Northwind Holdings LLC", cells: ["Northwind Holdings LLC"], cell_positions: [10] },
    { page: 1, text: "Invoice | 08/01/2026 | INV-1001 | N. Holdings ... | 08/16/2026 | 27 | 1,250.00", cells: ["Invoice", "08/01/2026", "INV-1001", "N. Holdings ...", "08/16/2026", "27", "1,250.00"], cell_positions: [12, 63, 105, 204, 332, 397, 468] },
    { page: 1, text: "Payment | 08/02/2026 | PMT-2 | Northwind ... | -250.00", cells: ["Payment", "08/02/2026", "PMT-2", "Northwind ...", "-250.00"], cell_positions: [12, 63, 105, 204, 468] },
    { page: 1, text: "General Journal | 08/02/2026 | JRN-2 | Northwind ... | -25.00", cells: ["General Journal", "08/02/2026", "JRN-2", "Northwind ...", "-25.00"], cell_positions: [12, 63, 105, 204, 468] },
    { page: 1, text: "Check | 08/02/2026 | CK-2 | Northwind ... | -10.00", cells: ["Check", "08/02/2026", "CK-2", "Northwind ...", "-10.00"], cell_positions: [12, 63, 105, 204, 468] },
    { page: 2, text: "Invoice | 08/03/2026 | INV-1002 | N. Holdings ... | 08/18/2026 | 25 | 300.00", cells: ["Invoice", "08/03/2026", "INV-1002", "N. Holdings ...", "08/18/2026", "25", "300.00"], cell_positions: [12, 63, 105, 204, 332, 397, 468] },
  ];

  const [, heading, invoice, payment, journal, check, noContext] = suggestCollectionsPdfRows(lines);
  assert.equal(heading.disposition, "header");
  assert.equal(invoice.disposition, "invoice");
  assert.equal(invoice.fields.customer_name, "Northwind Holdings LLC");
  assert.equal(payment.disposition, "ignored");
  assert.match(payment.reason, /retained as report evidence/);
  assert.equal(journal.disposition, "ignored");
  assert.equal(check.disposition, "ignored");
  assert.equal(noContext.disposition, "unreviewed", "a customer label must not leak across PDF pages");
});

test("a truncated customer is completed only by a unique same-date summary match and exact detail subtotal", () => {
  const detail = [
    { page: 1, text: "Type | Date | Num | Name | Terms | Due Date | Aging | Open Balance", cells: ["Type", "Date", "Num", "Name", "Terms", "Due Date", "Aging", "Open Balance"], cell_positions: [10, 60, 100, 160, 220, 300, 360, 430] },
    { page: 1, text: "Invoice | 08/01/2026 | INV-1001 | Example Or... | Net 30 | 08/31/2026 | 27 | 100.00", cells: ["Invoice", "08/01/2026", "INV-1001", "Example Or...", "Net 30", "08/31/2026", "27", "100.00"], cell_positions: [12, 63, 105, 165, 226, 302, 367, 438] },
    { page: 1, text: "Total Example Orchard LLC 100.00", cells: ["Total Example Orchard LLC 100.00"] },
  ];
  const summary = [
    { page: 1, text: "Example Orchard LLC | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 100.00", cells: ["Example Orchard LLC", "0.00", "0.00", "0.00", "0.00", "0.00", "100.00"] },
  ];
  const [header, invoice] = suggestCollectionsPdfRows(detail, summary);
  assert.equal(header.disposition, "header");
  assert.equal(invoice.disposition, "invoice");
  assert.equal(invoice.fields.customer_name, "Example Orchard LLC");
  assert.match(invoice.reason, /unique summary name with an exact detail subtotal/);

  const ambiguous = suggestCollectionsPdfRows(detail, [
    ...summary,
    { page: 1, text: "Example Orchard Limited | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 100.00", cells: ["Example Orchard Limited", "0.00", "0.00", "0.00", "0.00", "0.00", "100.00"] },
  ]);
  assert.equal(ambiguous[1].disposition, "unreviewed", "ambiguous prefix matches are not guessed");

  const mismatch = suggestCollectionsPdfRows(detail, [{
    ...summary[0], cells: ["Example Orchard LLC", "0.00", "0.00", "0.00", "0.00", "0.00", "99.00"],
  }]);
  assert.equal(mismatch[1].disposition, "unreviewed", "a non-matching subtotal does not resolve the customer");
});

test("a customer group containing the word Page is not mistaken for a page footer", () => {
  const lines = [
    { page: 1, text: "Type | Date | Num | Name | Terms | Due Date | Aging | Open Balance", cells: ["Type", "Date", "Num", "Name", "Terms", "Due Date", "Aging", "Open Balance"], cell_positions: [10, 60, 100, 160, 220, 300, 360, 430] },
    { page: 1, text: "North Page Services LLC", cells: ["North Page Services LLC"] },
  ];
  assert.equal(suggestCollectionsPdfRows(lines)[1].disposition, "header");
});

test("customer headings may include digits while obvious transaction IDs remain excluded", () => {
  const lines = [
    { page: 1, text: "Type | Date | Num | Name | Terms | Due Date | Aging | Open Balance", cells: ["Type", "Date", "Num", "Name", "Terms", "Due Date", "Aging", "Open Balance"] },
    { page: 1, text: "4D Medical Group LLC", cells: ["4D Medical Group LLC"] },
    { page: 1, text: "INV-4821", cells: ["INV-4821"] },
  ];
  const [, customer, transactionId] = suggestCollectionsPdfRows(lines);
  assert.equal(customer.disposition, "header");
  assert.equal(transactionId.disposition, "unreviewed");
});
