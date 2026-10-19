// LOCAL ONLY. A stand-in for the Resend email API, loaded into the dev server with
// `node --import` (see dev-fake-resend.mjs). Requests to https://api.resend.com/emails
// are answered in-process and recorded; nothing is sent and nothing is forwarded.
// It refuses to load unless the app points at the local Supabase stack.
//
// Control file (FAKE_RESEND_CONTROL, JSON, re-read on every request):
//   { "mode": "accept" | "rate_limit" | "server_error" | "reject" | "no_id" | "network_error" }
// Log file (FAKE_RESEND_LOG, one JSON object per request): recipient, sender,
// reply-to, subject, idempotency key, and whether the Authorization header was the
// expected dummy key. The key itself is never written.
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const local = (() => { try { return ["localhost", "127.0.0.1"].includes(new URL(supabaseUrl).hostname); } catch { return false; } })();
if (process.env.FAKE_RESEND !== "1" || !local || process.env.COLLECTIONS_NON_PRODUCTION !== "true") {
  throw new Error("fake-resend: refusing to load outside the local, non-production harness");
}

const RESEND = "https://api.resend.com/emails";
const realFetch = globalThis.fetch;
const idsByKey = new Map();
let counter = 0;

function mode() {
  const path = process.env.FAKE_RESEND_CONTROL;
  if (!path || !existsSync(path)) return "accept";
  try { return JSON.parse(readFileSync(path, "utf8")).mode || "accept"; } catch { return "accept"; }
}

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

globalThis.fetch = async function fakeResendFetch(input, init = {}) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith(RESEND)) return realFetch(input, init);
  const headers = new Headers(init.headers || (typeof input === "object" && "headers" in input ? input.headers : undefined));
  let body = {};
  try { body = JSON.parse(typeof init.body === "string" ? init.body : "{}"); } catch { body = {}; }
  const key = headers.get("Idempotency-Key") || "";
  const current = mode();
  const entry = {
    at: new Date().toISOString(), mode: current, to: body.to, from: body.from, reply_to: body.reply_to ?? null,
    subject: body.subject, text_length: typeof body.text === "string" ? body.text.length : 0, idempotency_key: key,
    dummy_key: headers.get("Authorization") === `Bearer ${process.env.FAKE_RESEND_EXPECTED_KEY || ""}`,
  };
  if (process.env.FAKE_RESEND_LOG) appendFileSync(process.env.FAKE_RESEND_LOG, `${JSON.stringify(entry)}\n`);
  if (current === "network_error") throw new TypeError("fake-resend: simulated network failure");
  if (current === "rate_limit") return json(429, { name: "rate_limit_exceeded", message: "Too many requests" });
  if (current === "server_error") return json(500, { name: "internal_server_error", message: "Simulated outage" });
  if (current === "reject") return json(422, { name: "validation_error", message: "Simulated rejection" });
  if (current === "no_id") return json(200, {});
  // Resend returns the original message id when an idempotency key is replayed.
  if (!idsByKey.has(key)) idsByKey.set(key, `fake_${Date.now().toString(36)}_${++counter}`);
  return json(200, { id: idsByKey.get(key) });
};
// Record which processes have the fake installed, so a harness can confirm the
// process that serves API routes is covered before running any test send.
if (process.env.FAKE_RESEND_LOG) appendFileSync(`${process.env.FAKE_RESEND_LOG}.loaded`, `${JSON.stringify({ pid: process.pid, script: process.argv[1] || "" })}\n`);
console.info(`[fake-resend] loaded in pid ${process.pid}: Resend API calls are answered locally and never sent`);
