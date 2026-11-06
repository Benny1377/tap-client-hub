import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("policy read is explicit, Owner/Admin-gated, and returns only policy fields", () => {
  const route = read("app/api/billing/[...path]/route.ts");
  const policy = route.slice(route.indexOf("async function policyGet()"), route.indexOf("async function clientServicesGet"));
  assert.match(policy, /requireBillingAction\("policy\.manage"\)/);
  assert.match(policy, /select\("action_key,allowed_roles,enabled"\)/);
  assert.match(policy, /effectiveBillingPolicy\(/);
  assert.match(route, /const roles=DELEGABLE_BILLING_ROLES/);
  assert.doesNotMatch(policy, /select\("\*"\)/);
});

test("client-services read is narrowly projected and requires either pricing or candidate view", () => {
  const route = read("app/api/billing/[...path]/route.ts");
  const services = route.slice(route.indexOf("async function clientServicesGet"), route.indexOf("async function listResource"));
  assert.match(services, /requireBillingAction\("pricing\.view"\)/);
  assert.match(services, /requireBillingAction\("candidates\.view"\)/);
  assert.match(services, /select\("id,active,frequency,service:services\(code,name\)"\)/);
  assert.match(services, /serviceCode: service\?\.code/);
  assert.match(services, /serviceName: service\?\.name/);
  assert.doesNotMatch(services, /select\("\*"\)/);
});

test("invoice list adds candidate provenance without returning the junction payload", () => {
  const route = read("app/api/billing/invoices/route.ts");
  assert.match(route, /invoice_lines\(\*, billing_candidate_line_links\(candidate_id,active\)\)/);
  assert.match(route, /candidateIds/);
  assert.match(route, /link\.active !== false/);
  assert.match(route, /const \{ billing_candidate_line_links: links, \.\.\.lineFields \} = line/);
});

test("Phase 3 contract records all review clarifications and new read shapes", () => {
  const contract = read("docs/contracts/billing-phase-3-workbench.md");
  for (const phrase of [
    "GET /api/billing/permissions/policy",
    "GET /api/billing/client-services?clientId=",
    "candidateIds",
    "created:false",
    "full replacement",
    "all-client projection or generation",
    "identified Operations project",
    "read-only compatibility check from an isolated Preview",
    "Operations-owner-approved service",
  ]) assert.ok(contract.includes(phrase), `missing Phase 3 contract rule: ${phrase}`);
});
