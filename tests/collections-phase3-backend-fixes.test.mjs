// Engineer A proposed fixes on top of af2a52e: send-window guard and the
// reopen ordering in the test-run worker. No database or provider access.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTs } from "./helpers/load-ts.mjs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const { isRetryableDelivery, isWithinSendWindow } = loadTs("lib/collections-delivery.ts");
const firm = { timezone: "America/Chicago", send_start: "09:00:00", send_end: "17:00:00", weekdays_only: true };

test("send window follows the firm timezone, hours and weekdays", () => {
  // 2026-10-16 is a Friday; Chicago is UTC-5 (CDT) on that date.
  assert.equal(isWithinSendWindow(firm, new Date("2026-10-16T14:00:00Z")), true, "Fri 09:00 Chicago opens the window");
  assert.equal(isWithinSendWindow(firm, new Date("2026-10-16T13:59:59Z")), false, "Fri 08:59:59 is before the window");
  assert.equal(isWithinSendWindow(firm, new Date("2026-10-16T21:59:59Z")), true, "Fri 16:59:59 is inside");
  assert.equal(isWithinSendWindow(firm, new Date("2026-10-16T22:00:00Z")), false, "Fri 17:00 closes the window");
  assert.equal(isWithinSendWindow(firm, new Date("2026-10-17T15:00:00Z")), false, "Saturday is closed when weekdays_only");
  assert.equal(isWithinSendWindow({ ...firm, weekdays_only: false }, new Date("2026-10-17T15:00:00Z")), true, "Saturday opens without weekdays_only");
  assert.equal(isWithinSendWindow({ ...firm, send_start: "9:00", send_end: "17:00" }, new Date("2026-10-16T14:30:00Z")), true, "short HH:MM values");
  assert.equal(isWithinSendWindow({ ...firm, timezone: "Not/AZone" }, new Date("2026-10-16T15:00:00Z")), false, "unknown timezone fails closed");
});

test("transient retry is limited to the provider idempotency retention window", () => {
  const now = Date.parse("2026-10-18T12:00:00Z");
  assert.equal(isRetryableDelivery("PROVIDER_RATE_LIMITED", 1, "2026-10-18T11:00:00Z", now), true);
  assert.equal(isRetryableDelivery("PROVIDER_TEMPORARY_FAILURE", 4, "2026-10-17T12:59:59Z", now), false, "23-hour safety buffer");
  assert.equal(isRetryableDelivery("PROVIDER_RATE_LIMITED", 5, "2026-10-18T11:00:00Z", now), false, "retry cap");
  assert.equal(isRetryableDelivery("PROVIDER_REJECTED", 1, "2026-10-18T11:00:00Z", now), false, "permanent rejection");
});

test("a run outside the window stops before creating attempts", () => {
  const run = source("lib/collections-test-run.ts");
  const guard = run.indexOf("if (!isWithinSendWindow(settings)) return OUTSIDE_SEND_WINDOW;");
  assert.ok(guard > 0, "window guard present");
  assert.ok(guard < run.indexOf('db.from("collection_delivery_attempts").insert('), "guard runs before any attempt insert");
  for (const path of ["app/api/collections/automation/test-run/route.ts", "app/api/collections/automation/run/route.ts"]) {
    assert.match(source(path), /result === OUTSIDE_SEND_WINDOW[\s\S]*?code: "OUTSIDE_SEND_WINDOW"[\s\S]*?status: 409/, path);
  }
});

test("pre-checks run before a suppressed attempt is reopened, so nothing is left queued", () => {
  const run = source("lib/collections-test-run.ts");
  const preCheck = run.indexOf("const preReason =");
  const reopen = run.indexOf('update({ status: "queued"');
  assert.ok(preCheck > 0 && reopen > 0 && preCheck < reopen, "pre-checks come first");
  assert.match(run, /existing && \["queued", "suppressed"\]\.includes\(existing\.status\)[\s\S]*?status: "suppressed", reason_code: preReason/);
  assert.match(run, /existing\.status !== "suppressed" && existing\.status !== "queued"\) continue;/, "handled attempts are not counted as suppressed");
});

test("stage 4 has a fixed internal test label and the whole body template is escaped", () => {
  const run = source("lib/collections-test-run.ts");
  assert.match(run, /stage === 4 \? "Internal Owner-escalation notice — TEST"/);
  assert.match(run, /stage === 4 \? "<strong>Internal Owner-escalation notice — TEST<\/strong><br>"/);
  assert.match(run, /renderCollectionsTemplate\(String\(rule\.body_template\), values, true\)/);
});

test("database refusal codes are distinct and have plain-language text", () => {
  const migration = source("supabase/migrations/20261018110000_collections_delivery_reason_codes.sql");
  const delivery = source("lib/collections-delivery.ts");
  for (const code of ["STAGE_NOT_DUE", "INVOICE_NOT_ELIGIBLE", "OUTSIDE_SEND_WINDOW"]) {
    assert.ok(migration.includes(`return '${code}'`) || migration.includes(`'reason_code', '${code}'`), `${code} emitted by the database`);
    assert.match(delivery, new RegExp(`${code}: ".+"`), `${code} has user-facing wording`);
  }
});

test("a retry with changed rendered content is refused before the provider call", () => {
  const run = source("lib/collections-test-run.ts");
  const fingerprint = run.indexOf('db.rpc("record_collection_test_payload_fingerprint"');
  const provider = run.indexOf("sendResendEmail(request)");
  assert.ok(fingerprint > 0 && provider > 0 && fingerprint < provider);
  assert.match(run, /fingerprintError \|\| fingerprintRecorded !== true[\s\S]*?status: "needs_review", reason_code: "PROVIDER_PAYLOAD_CHANGED"/);
});
