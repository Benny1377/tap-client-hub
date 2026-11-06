import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const access = loadTs("lib/payroll-credentials.ts");

test("Payroll credential visibility follows Owner/Admin or Payroll module access", () => {
  assert.equal(access.canViewPayrollCredentials({ role: "owner", allowedModules: [] }), true);
  assert.equal(access.canViewPayrollCredentials({ role: "admin", allowedModules: [] }), true);
  assert.equal(access.canViewPayrollCredentials({ role: "staff", allowedModules: ["Payroll"] }), true);
  assert.equal(access.canViewPayrollCredentials({ role: "staff", allowedModules: ["Billing", "Collections"] }), false);
});

test("client updates from non-Payroll users omit PIN and EFTPS values without dropping other service fields", () => {
  const input = {
    id: "client-1",
    services: [
      { key: "payroll", frequency: "Monthly", payrollPassword: "secret", eftps: "secret-2" },
      { key: "financials", frequency: "Monthly" },
    ],
  };
  const safe = access.omitPayrollCredentialsFromClientUpdate(input, false);
  assert.deepEqual(safe, {
    id: "client-1",
    services: [
      { key: "payroll", frequency: "Monthly" },
      { key: "financials", frequency: "Monthly" },
    ],
  });
  assert.deepEqual(access.omitPayrollCredentialsFromClientUpdate(input, true), input);
});
