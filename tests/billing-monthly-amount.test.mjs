import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const amounts = loadTs("lib/billing-monthly-amount.ts");

test("monthly amount helpers preserve decimal cents and negative credit buckets", () => {
  assert.equal(amounts.moneyToCents("125.40"), 12540);
  assert.equal(amounts.moneyToCents("-12.34"), -1234);
  assert.equal(amounts.moneyToCents("9999999999.99"), 999999999999);
  assert.equal(amounts.moneyToCents("1.234"), null);
  assert.equal(amounts.centsToMoney(-1234), "-12.34");
});

test("monthly average supports Operations cadence values and flags unknown cadence", () => {
  assert.equal(amounts.occurrencesPerYear("Bi-Weekly A"), 26);
  assert.equal(amounts.occurrencesPerYear("Bi-Weekly B"), 26);
  assert.equal(amounts.occurrencesPerYear("Semi-Monthly"), 24);
  assert.equal(amounts.occurrencesPerYear("Weekly"), 52);
  assert.equal(amounts.occurrencesPerYear("Monthly"), 12);
  assert.equal(amounts.occurrencesPerYear("Quarterly"), 4);
  assert.equal(amounts.occurrencesPerYear("Yearly"), 1);
  assert.equal(amounts.occurrencesPerYear("Every other Tuesday"), null);
  assert.equal(amounts.centsToMoney(amounts.averageMonthlyCents(10000, 26)), "216.67");
  assert.equal(amounts.centsToMoney(amounts.averageMonthlyCents(-10000, 26)), "-216.67");
});
