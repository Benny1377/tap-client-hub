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

test("presentation settings reads are Billing-gated and writes are Owner/Admin-only and audited", () => {
  const route = read("app/api/billing/[...path]/route.ts");
  const get = route.slice(route.indexOf("async function presentationGet"), route.indexOf("async function presentationPatch"));
  const patch = route.slice(route.indexOf("async function presentationPatch"), route.indexOf("async function listResource"));
  assert.match(get, /requireBillingAction\("billing\.view"\)/);
  assert.match(get, /select\("firm_name,tagline,invoice_footer,updated_at"\)/);
  assert.match(patch, /requireBillingPowerUser\(\)/);
  assert.match(patch, /updated_by: access\.identity\.id/);
  assert.match(patch, /reason,/) ;
  assert.match(patch, /Unsupported presentation setting/);
  assert.doesNotMatch(get, /select\("\*"\)/);
});

test("firm schedule is gated by both view actions and uses the bounded database projection with opaque cursors", () => {
  const route = read("app/api/billing/[...path]/route.ts");
  const schedule = route.slice(route.indexOf("async function firmScheduleGet"), route.indexOf("async function listResource"));
  assert.match(schedule, /requireBillingAction\("candidates\.view"\)/);
  assert.match(schedule, /requireBillingAction\("pricing\.view"\)/);
  assert.match(schedule, /boundedLimit\(query\.get\("limit"\)\)/);
  assert.match(schedule, /project_billing_firm_schedule/);
  assert.match(schedule, /cursorEncode\(/);
  assert.doesNotMatch(schedule, /generateFromOperations/);
});

test("client summary is client-scoped, permission-gated, and returns ledger and server price projections", () => {
  const route = read("app/api/billing/[...path]/route.ts");
  const summary = route.slice(route.indexOf("async function clientSummaryGet"), route.indexOf("async function firmScheduleGet"));
  assert.match(summary, /requireBillingAction\("pricing\.view"\)/);
  assert.match(summary, /requireBillingAction\("candidates\.view"\)/);
  assert.match(summary, /resolve_billing_price/);
  assert.match(summary, /get_billing_receivables/);
  assert.match(summary, /generateFromOperations\(db,[\s\S]*preview: true/);
  assert.match(summary, /monthlyAmount: centsToMoney/);
});

test("presentation migration is mirrored byte-for-byte and protects metadata with RLS", () => {
  const migration = read("supabase/migrations/20261106110000_billing_presentation_settings.sql");
  const mirror = read("tools/sandbox/supabase/migrations/20261106110000_billing_presentation_settings.sql");
  assert.equal(mirror, migration);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /project_billing_firm_schedule/);
  assert.match(migration, /grant execute[\s\S]*to service_role/);
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
    "GET /api/billing/candidates/firm-schedule?from=",
    "GET /api/billing/clients/summary?clientId=",
    "GET /api/billing/settings/presentation",
    "PATCH /api/billing/settings/presentation",
    "GET /api/billing/candidates/firm-schedule?from=",
    "GET /api/billing/clients/summary?clientId=",
    "projectedAmount",
    "sourceIdentity}],nextCursor,summary",
    "monthlyAmount",
    "monthlyAmountComplete,unpricedServiceCount",
    "invoiceNumberPrefix:\"TAP\"",
    "candidateIds",
    "created:false",
    "full replacement",
    "separately approved firm-wide schedule is read-only",
    "identified Operations project",
    "read-only compatibility check from an isolated Preview",
    "Operations-owner-approved service",
  ]) assert.ok(contract.includes(phrase), `missing Phase 3 contract rule: ${phrase}`);
});
