import test from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./helpers/load-ts.mjs";

const { resendPayloadFingerprint, sendResendEmail } = loadTs("lib/collections-provider.ts");
const email = {
  apiKey: "mock-only",
  from: "Collections Test <test@example.invalid>",
  to: "owner@example.invalid",
  replyTo: "reply@example.invalid",
  subject: "TEST invoice",
  html: "<p>synthetic fixture</p>",
  text: "synthetic fixture",
  idempotencyKey: "collections:fixture-invoice:stage:1",
};
const response = (status, body = "") => new Response(body, { status, headers: { "Content-Type": "application/json" } });

test("provider acceptance requires a valid provider message id", async () => {
  const accepted = await sendResendEmail(email, async () => response(200, JSON.stringify({ id: "mock-email-1" })));
  const missingId = await sendResendEmail(email, async () => response(200, JSON.stringify({})));
  const malformed = await sendResendEmail(email, async () => response(200, "not-json"));
  assert.deepEqual(accepted, { status: "accepted", reason: null, messageId: "mock-email-1" });
  assert.equal(missingId.reason, "PROVIDER_OUTCOME_UNKNOWN");
  assert.equal(malformed.reason, "PROVIDER_OUTCOME_UNKNOWN");
});

test("provider rejection, rate limit, and server error map to stable outcomes", async () => {
  const rateLimited = await sendResendEmail(email, async () => response(429));
  const temporary = await sendResendEmail(email, async () => response(503));
  const rejected = await sendResendEmail(email, async () => response(422));
  assert.equal(rateLimited.reason, "PROVIDER_RATE_LIMITED");
  assert.equal(temporary.reason, "PROVIDER_TEMPORARY_FAILURE");
  assert.equal(rejected.reason, "PROVIDER_REJECTED");
});

test("timeout or transport failure is uncertain and must not be blindly retried", async () => {
  const timeout = await sendResendEmail(email, async () => { throw new DOMException("timed out", "TimeoutError"); });
  assert.deepEqual(timeout, { status: "needs_review", reason: "PROVIDER_OUTCOME_UNKNOWN", messageId: null });
});

test("retry reuses the same key and byte-equivalent request payload", async () => {
  const captured = [];
  const fetcher = async (_url, init) => {
    captured.push({ key: new Headers(init.headers).get("Idempotency-Key"), body: init.body });
    return captured.length === 1 ? response(429) : response(200, JSON.stringify({ id: "mock-email-2" }));
  };
  assert.equal((await sendResendEmail(email, fetcher)).reason, "PROVIDER_RATE_LIMITED");
  assert.equal((await sendResendEmail(email, fetcher)).status, "accepted");
  assert.deepEqual(captured[0], captured[1]);
  assert.equal(captured[0].key, email.idempotencyKey);
});

test("payload fingerprint is stable for an identical retry and changes with edited content", () => {
  const original = resendPayloadFingerprint(email);
  assert.equal(resendPayloadFingerprint({ ...email }), original);
  assert.notEqual(resendPayloadFingerprint({ ...email, html: "updated balance" }), original);
});
