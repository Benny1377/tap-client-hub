import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const clientsRoute = read("app/api/clients/route.ts");
const workPeriodsRoute = read("app/api/work-periods/route.ts");
const sendEmailRoute = read("app/api/send-email/route.ts");
const email2fa = read("lib/email-2fa.ts");
const authUser = read("lib/supabase/auth-user.ts");
const clientSlideover = read("components/client-slideover.tsx");
const workloadRoute = read("app/api/workload/route.ts");

const tests = [
  ["PATCH accepts the 1099 expectedAnnual field sent by ClientSlideover", () => {
    assert.match(clientsRoute, /expectedAnnual/);
    assert.match(clientsRoute, /if \(expectedAnnual !== undefined\) updates\.expected_annual =/);
  }],
  ["financials month is persisted through both PUT and PATCH", () => {
    assert.match(clientsRoute, /financialsMonth/);
    assert.match(clientsRoute, /financials_month/);
    assert.match(clientsRoute, /if \(financialsMonth !== undefined\) updates\.financials_month =/);
  }],
  ["PUT loads complete existing service rows before applying fallbacks", () => {
    assert.match(clientsRoute, /\.from\(["']client_services["']\)\s*\n\s*\.select\(["']\*["']\)\s*\n\s*\.eq\(["']client_id["'], clientId\)/);
  }],
  ["PUT surfaces client-service write failures", () => {
    assert.match(clientsRoute, /Service activation failed/);
    assert.match(clientsRoute, /Service update failed/);
    assert.match(clientsRoute, /Service deactivation failed/);
  }],
  ["client comments use the deployed unified comments table", () => {
    assert.doesNotMatch(clientsRoute, /\.from\(["']service_comments["']\)/);
    assert.match(clientsRoute, /entity_type[^\n]+["']service["']/);
  }],
  ["work-period client filtering does not rely on a missing PostgREST relationship", () => {
    assert.doesNotMatch(workPeriodsRoute, /client_service:client_services/);
    assert.match(workPeriodsRoute, /\.from\(["']client_services["']\)/);
    assert.match(workPeriodsRoute, /\.in\(["']client_service_id["']/);
  }],
  ["work-period reads surface backend errors instead of returning false empty data", () => {
    assert.match(workPeriodsRoute, /error/);
    assert.match(workPeriodsRoute, /status:\s*500/);
  }],
  ["work-period writes preserve the frontend snake_case contract and integer DB period", () => {
    assert.match(workPeriodsRoute, /client_service_id/);
    assert.match(workPeriodsRoute, /normalizedPeriod = String\(rawPeriod\)\.replace\(["']-["']/);
    assert.match(workPeriodsRoute, /period:\s*periodInt/);
  }],
  ["Resend requests use Bearer authorization", () => {
    assert.match(sendEmailRoute, /Authorization:\s*`Bearer \$\{resendKey\}`/);
    assert.match(email2fa, /Authorization:\s*`Bearer \$\{resendKey\}`/);
  }],
  // The project comes from NEXT_PUBLIC_SUPABASE_URL; no project or host is hardcoded,
  // so a missing setting fails instead of sending sessions to another host.
  ["2FA authentication uses the configured Supabase project, with no hardcoded host", () => {
    assert.match(authUser, /process\.env\.NEXT_PUBLIC_SUPABASE_URL!/);
    assert.doesNotMatch(authUser, /phgogybfgovrlcdmifpv|mom-ai-agency|https:\/\//);
  }],
  ["assigned staff names resolve to profile IDs and empty service lists do not throw", () => {
    assert.match(clientsRoute, /\.from\(["']profiles["']\)[\s\S]{0,250}\.eq\(["']full_name["'], assignedStaffVal\)/);
    assert.match(clientsRoute, /\.limit\(1\)\.maybeSingle\(\)/);
  }],
  ["new service PUT responses return csId and update the slideover state", () => {
    assert.match(clientsRoute, /action: ["']created["'], csId: newCsId/);
    assert.match(clientsRoute, /action: ["']already_active["'], csId: existing\.id/);
    assert.match(clientSlideover, /payload\.results\?\.find/);
    assert.match(clientSlideover, /csId: created\.csId/);
  }],
  ["workload staff query uses deployed profile columns and surfaces query failures", () => {
    assert.doesNotMatch(workloadRoute, /invite_status/);
    assert.match(workloadRoute, /clientsError \|\| servicesError \|\| profilesError/);
    assert.match(workloadRoute, /status:\s*500/);
  }],
];

let passed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

console.log(`\n${passed}/${tests.length} API contract regression checks passed`);
