import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/financials-export.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(`(function(module, exports) { ${compiled}\n})(module, module.exports);`, { module });
const { financialsExportHeaders, financialsExportValues } = module.exports;

assert.deepEqual(Array.from(financialsExportHeaders()), [
  "Year", "Months Included", "Completed Months", "Completed Through",
  "Jan Status", "Feb Status", "Mar Status", "Apr Status", "May Status", "Jun Status",
  "Jul Status", "Aug Status", "Sep Status", "Oct Status", "Nov Status", "Dec Status",
]);

const quarterly = financialsExportValues(
  { frequency: "Quarterly", financialsMonth: 1 },
  ["", "dn", "", "", "dn", "", "", "ip", "", "", "dn", ""],
  2026,
);
assert.equal(quarterly[0], 2026);
assert.equal(quarterly[1], "Feb, May, Aug, Nov");
assert.equal(quarterly[2], "Feb, May, Nov");
assert.equal(quarterly[3], "May", "completion-through stops at first incomplete included month");
assert.equal(quarterly[4], "", "inactive months remain blank");
assert.equal(quarterly[5], "Completed");
assert.equal(quarterly[8], "Completed");
assert.equal(quarterly[11], "In progress");
assert.equal(quarterly.length, 16);

const monthly = financialsExportValues(
  { frequency: "Monthly", financialsMonth: 0 },
  ["dn", "dn", "wc", "dn"],
  2025,
);
assert.equal(monthly[1], "Jan, Feb, Mar, Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec");
assert.equal(monthly[2], "Jan, Feb, Apr");
assert.equal(monthly[3], "Feb", "completed-through reports the last consecutive completed month");
assert.equal(monthly[6], "Waiting on client");
assert.equal(monthly[15], "Not started");

console.log("financials export data checks passed");
