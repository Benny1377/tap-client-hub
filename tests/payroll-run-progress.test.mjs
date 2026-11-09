import assert from "node:assert/strict";

const {
  adjustPayrollRunCount,
  getPayrollScheduleCountKey,
  getPayrollSchedules,
} = await import(new URL("../lib/payroll-run-progress.ts", import.meta.url).href);
const { payrollMonthCategories } = await import(new URL("../lib/worklist-kpi-filter.ts", import.meta.url).href);

const weekly = { key: "payroll", csId: "cs-weekly", frequency: "Weekly" };
const semimonthly = { key: "payroll", csId: "cs-semi", frequency: "Semi-Monthly" };
const schedules = getPayrollSchedules([weekly, semimonthly]);
assert.deepEqual(schedules.map((schedule) => schedule.csId), ["cs-weekly", "cs-semi"]);
assert.notEqual(getPayrollScheduleCountKey("client-1", weekly.csId), getPayrollScheduleCountKey("client-1", semimonthly.csId));
assert.equal(adjustPayrollRunCount(1, 5, 1), 2);
assert.equal(adjustPayrollRunCount(5, 5, 1), 5);
assert.equal(adjustPayrollRunCount(2, 5, -1), 1);
assert.equal(adjustPayrollRunCount(0, 2, -1), 0);

const multiCadenceClient = {
  id: "client-multi",
  services: [{ key: "payroll", enabled: true, frequency: "Weekly", months: Array(12).fill("") }],
  payrollSchedules: [weekly, semimonthly],
};
assert.equal(payrollMonthCategories(multiCadenceClient, "payroll", { "client-multi:payroll": [5] })[0], "in_progress");
assert.equal(payrollMonthCategories(multiCadenceClient, "payroll", { "client-multi:payroll": [7] })[0], "completed");

console.log("payroll multi-schedule run progress tests passed");
