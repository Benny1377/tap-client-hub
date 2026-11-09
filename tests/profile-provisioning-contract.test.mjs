import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("../app/api/profiles/route.ts", import.meta.url), "utf8");

assert.match(route, /auth\.admin\.createUser\(/, "user provisioning must use the privileged Auth Admin API");
assert.match(route, /\.ilike\("email",\s*normalizedEmail\)/, "existing profiles must be reconciled by normalized email");
assert.match(route, /existingProfile[\s\S]*?\.update\(profilePayload\)[\s\S]*?\.eq\("id",\s*existingProfile\.id\)/, "existing legacy profile rows must be updated without replacing their IDs");
assert.match(route, /existingProfile\s*\?\s*await[\s\S]*?:\s*await[\s\S]*?\.insert\(/, "new profiles should be inserted only when no email match exists");
console.log("profile provisioning regression tests passed");
