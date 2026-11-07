import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const amounts = loadTs("lib/billing-monthly-amount.ts");

test("monthly amount helpers preserve decimal cents and negative credit buckets", () => {
  assert.equal(amounts.moneyToCents("125.40"), 12540n);
  assert.equal(amounts.moneyToCents("-12.34"), -1234n);
  assert.equal(amounts.moneyToCents("1.234"), null);
  assert.equal(amounts.centsToMoney(-1234n), "-12.34");
});

test("monthly average supports Operations cadence values and flags unknown cadence", () => {
  assert.equal(amounts.occurrencesPerYear("Bi-Weekly A"), 26n);
  assert.equal(amounts.occurrencesPerYear("Bi-Weekly B"), 26n);
  assert.equal(amounts.occurrencesPerYear("Semi-Monthly"), 24n);
  assert.equal(amounts.occurrencesPerYear("Weekly"), 52n);
  assert.equal(amounts.occurrencesPerYear("Monthly"), 12n);
  assert.equal(amounts.occurrencesPerYear("Quarterly"), 4n);
  assert.equal(amounts.occurrencesPerYear("Yearly"), 1n);
  assert.equal(amounts.occurrencesPerYear("Every other Tuesday"), null);
  assert.equal(amounts.centsToMoney(amounts.averageMonthlyCents(10000n, 26n)), "216.67");
  assert.equal(amounts.centsToMoney(amounts.averageMonthlyCents(-10000n, 26n)), "-216.67");
});
