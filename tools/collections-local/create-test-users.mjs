// LOCAL ONLY. Creates Supabase Auth users on the disposable tools/collections-local
// stack whose ids match the fictional tap_hub_project.profiles rows, so the app can
// be signed into for browser/API validation. Refuses any URL other than the local
// stack. Passwords are random, written to the git-ignored .env.local, never printed.
//
//   node tools/collections-local/create-test-users.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const ENV_FILE = ".env.local";
const lines = readFileSync(ENV_FILE, "utf8").split(/\r?\n/);
const env = Object.fromEntries(lines.filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const url = env.NEXT_PUBLIC_SUPABASE_URL;
if (!/^http:\/\/127\.0\.0\.1:55321\/?$/.test(url || "")) {
  console.error("Refusing: NEXT_PUBLIC_SUPABASE_URL in .env.local is not the local stack (http://127.0.0.1:55321).");
  process.exit(2);
}
const key = env.SUPABASE_SERVICE_ROLE_KEY;

const USERS = [
  ["OWNER", "00000000-0000-4000-8000-000000000001", "owner@example.invalid"],
  ["STAFF_COLLECTIONS", "00000000-0000-4000-8000-000000000002", "staff@example.invalid"],
  ["ADMIN", "00000000-0000-4000-8000-000000000003", "admin@example.invalid"],
  ["STAFF_BILLING", "00000000-0000-4000-8000-000000000004", "billing@example.invalid"],
  ["STAFF_UNASSIGNED", "00000000-0000-4000-8000-000000000005", "unassigned@example.invalid"],
];

const created = [];
for (const [name, id, email] of USERS) {
  const password = `Local-${randomBytes(12).toString("base64url")}`;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  let res = await fetch(`${url}/auth/v1/admin/users`, { method: "POST", headers, body: JSON.stringify({ id, email, password, email_confirm: true }) });
  if (res.status === 422) {
    // Already exists from an earlier run: reset its password instead.
    res = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: "PUT", headers, body: JSON.stringify({ password }) });
  }
  const body = await res.json().catch(() => ({}));
  const userId = body.id || body.user?.id;
  console.log(`${name}: HTTP ${res.status}${userId ? (userId === id ? " (id matches profile)" : " (ID MISMATCH)") : ` ${body.msg || body.error || ""}`}`);
  if (res.ok) created.push([name, email, password]);
}

const kept = lines.filter((l) => !/^TEST_[A-Z_]+_(EMAIL|PASSWORD)=/.test(l) && l !== "# LOCAL-ONLY test logins (local Supabase Auth only).");
while (kept.length && kept[kept.length - 1] === "") kept.pop();
kept.push("", "# LOCAL-ONLY test logins (local Supabase Auth only).");
for (const [name, email, password] of created) kept.push(`TEST_${name}_EMAIL=${email}`, `TEST_${name}_PASSWORD=${password}`);
writeFileSync(ENV_FILE, kept.join("\n") + "\n");
