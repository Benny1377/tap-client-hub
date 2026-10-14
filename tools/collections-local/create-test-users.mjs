// Creates fixed-ID Auth accounts only on the disposable local Supabase stack.
// Random passwords are written to the ignored .env.local and never printed.
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const envPath = resolve(projectRoot, ".env.local");
let lines;
try {
  lines = readFileSync(envPath, "utf8").split(/\r?\n/);
} catch {
  console.error("Create .env.local with local Supabase values from `supabase status --workdir tools/collections-local`, then retry.");
  process.exit(2);
}

const env = Object.fromEntries(lines.flatMap((line) => {
  const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (!match) return [];
  let value = match[2];
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return [[match[1], value]];
}));

const url = env.NEXT_PUBLIC_SUPABASE_URL;
if (!/^http:\/\/127\.0\.0\.1:55321\/?$/.test(url || "")) {
  console.error("Refusing: .env.local must target exactly http://127.0.0.1:55321.");
  process.exit(2);
}
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey) {
  console.error("Refusing: SUPABASE_SERVICE_ROLE_KEY is missing from .env.local.");
  process.exit(2);
}

const users = [
  ["OWNER", "00000000-0000-4000-8000-000000000001", "owner@example.invalid"],
  ["STAFF_COLLECTIONS", "00000000-0000-4000-8000-000000000002", "staff@example.invalid"],
  ["ADMIN", "00000000-0000-4000-8000-000000000003", "admin@example.invalid"],
  ["STAFF_BILLING", "00000000-0000-4000-8000-000000000004", "billing@example.invalid"],
  ["STAFF_UNASSIGNED", "00000000-0000-4000-8000-000000000005", "unassigned@example.invalid"],
];
const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
};
const baseUrl = url.replace(/\/$/, "");
const created = [];

for (const [name, id, email] of users) {
  const password = `Local-${randomBytes(18).toString("base64url")}aA1!`;
  let response = await fetch(`${baseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({ id, email, password, email_confirm: true }),
  });
  if (response.status === 422) {
    response = await fetch(`${baseUrl}/auth/v1/admin/users/${id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ password }),
    });
  }
  const payload = await response.json().catch(() => ({}));
  const actualId = payload.id || payload.user?.id;
  if (!response.ok || actualId !== id) {
    console.error(`Could not provision ${name} on the local Auth service (HTTP ${response.status}).`);
    process.exit(1);
  }
  created.push([name, email, password]);
  console.log(`${name}: local Auth user ready; ID matches the synthetic profile.`);
}

const kept = lines.filter((line) => !/^TEST_[A-Z_]+_(EMAIL|PASSWORD)=/.test(line));
while (kept.length && kept[kept.length - 1] === "") kept.pop();
kept.push("", "# LOCAL-ONLY test logins (local Supabase Auth only).");
for (const [name, email, password] of created) {
  kept.push(`TEST_${name}_EMAIL=${email}`, `TEST_${name}_PASSWORD=${password}`);
}
writeFileSync(envPath, `${kept.join("\n")}\n`);
console.log("Random test passwords were saved to the ignored .env.local; none were printed.");
