// LOCAL ONLY. Starts the dev server on port 3002 with the fake Resend provider
// (fake-resend.mjs) and synthetic test-delivery settings, so Phase 3 test sends can
// run end to end without a verified domain, a real API key, or any email leaving
// the machine. These variables override .env.local (Next does not replace values
// already in the environment); the real Resend key, if present there, is not used.
//
// Usage: node tools/collections-local/dev-fake-resend.mjs
//   FAKE_RESEND_LOG / FAKE_RESEND_CONTROL default to tools/collections-local/.fake-resend/
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const state = join(here, ".fake-resend");
mkdirSync(state, { recursive: true });

const DUMMY_KEY = "re_fake_local_only_not_a_real_key";
const env = {
  ...process.env,
  FAKE_RESEND: "1",
  FAKE_RESEND_EXPECTED_KEY: DUMMY_KEY,
  FAKE_RESEND_LOG: process.env.FAKE_RESEND_LOG || join(state, "requests.jsonl"),
  FAKE_RESEND_CONTROL: process.env.FAKE_RESEND_CONTROL || join(state, "control.json"),
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321",
  COLLECTIONS_NON_PRODUCTION: "true",
  COLLECTIONS_MODE: "test",
  COLLECTIONS_RESEND_API_KEY: DUMMY_KEY,
  COLLECTIONS_SENDER_EMAIL: "collections-test@example.test",
  COLLECTIONS_SENDER_VERIFIED: "true",
  COLLECTIONS_SENDER_NAME: "TAP Collections Test",
  COLLECTIONS_REPLY_TO: "replies-test@example.test",
  COLLECTIONS_TEST_RECIPIENT: "test-inbox@example.test",
  NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --import=${pathToFileURL(join(here, "fake-resend.mjs")).href}`.trim(),
};

const child = spawn(process.execPath, [join(root, "node_modules", "next", "dist", "bin", "next"), "dev", "--port", "3002"], { cwd: root, env, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
