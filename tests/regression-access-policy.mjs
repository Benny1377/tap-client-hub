import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), "utf8");

function loadPolicy() {
  const source = read("lib/access-policy.ts");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function(module, exports, require) { ${js}\n})(module, module.exports, require);`, {
    module,
    require: () => { throw new Error("Unexpected dependency in access policy"); },
  });
  return module.exports;
}

const policy = loadPolicy();

assert.equal(policy.normalizeRole("Owner / Admin"), "owner");
assert.equal(policy.normalizeRole("Offshore (India)"), "offshore");
assert.equal(policy.canManageUsers("admin"), true);
assert.equal(policy.canManageUsers("owner"), true);
assert.equal(policy.canManageUsers("manager"), false, "canManageUsers stays owner/admin-only (add/delete/provision)");
assert.equal(policy.canManageUsers("manager", true), true, "an explicitly authorized manager can provision and manage users");
assert.equal(policy.canManageUsers("staff", true), false, "the explicit capability cannot elevate a staff role");
assert.equal(policy.effectiveModules("manager", ["Clients", "Users & Access"]).includes("Users & Access"), true, "assigned managers can see Users & Access");
assert.equal(policy.canAccessPathname("manager", ["Clients", "Users & Access"], "/users"), true, "assigned managers can open the Users & Access directory");
for (const role of ["staff", "offshore"]) {
  assert.equal(policy.canManageUsers(role), false, `${role} must not manage users`);
  assert.equal(policy.effectiveModules(role, ["Clients", "Users & Access"]).includes("Users & Access"), false);
  assert.equal(policy.canAccessPathname(role, ["Clients"], "/users"), false);
}
assert.equal(policy.canAccessPathname("staff", ["Clients"], "/pr"), false);
assert.equal(policy.canAccessPathname("staff", ["Clients", "Payroll"], "/pr"), true);
assert.equal(policy.canAccessPathname("manager", ["Financials"], "/fin"), true);
assert.equal(policy.canAccessPathname("offshore", ["Vault"], "/vault"), true);
assert.equal(policy.canAccessPathname("admin", [], "/users"), true);
assert.equal(policy.firstAllowedRoute("staff", ["Payroll"]), "/pr");
assert.deepEqual(Array.from(policy.sanitizeModulesForRole("staff", ["Clients", "Users & Access"])), ["Clients"]);

// Manager-safe module sanitization: managers may edit ordinary module
// assignments, but can never grant (nor revoke) the role-controlled
// "Users & Access" module for a target.
assert.deepEqual(
  Array.from(policy.sanitizeManagerModules("staff", [], ["Clients", "Users & Access"])),
  ["Clients"],
  "managers cannot grant Users & Access to non-managers",
);
assert.deepEqual(
  Array.from(policy.sanitizeManagerModules("manager", ["Clients", "Users & Access"], ["Clients"])),
  ["Clients", "Users & Access"],
  "managers cannot revoke an existing Users & Access assignment",
);
assert.deepEqual(
  Array.from(policy.sanitizeManagerModules("staff", ["Clients", "Payroll"], ["Clients"])),
  ["Clients"],
  "managers can edit ordinary module assignments",
);

const layout = read("app/layout.tsx");
assert.match(layout, /accessLoading/);
assert.match(layout, /fetch\("\/api\/me"/);
assert.match(layout, /canAccessPathname\(role, userModules, pathname\)/);
assert.match(layout, /router\.replace\(firstAllowedRoute/);
assert.match(layout, /router\.push\(item\.href\)/);
assert.match(layout, /Loading navigation/);
assert.doesNotMatch(layout, /useState\(\(\) =>[\s\S]{0,500}tap_demo_role/);

const meRoute = read("app/api/me/route.ts");
assert.match(meRoute, /resolveAccessIdentity/);
assert.match(meRoute, /status: 401/);

for (const route of [
  "app/api/profiles/route.ts",
  "app/api/profiles/[id]/route.ts",
  "app/api/2fa/admin-toggle/route.ts",
]) {
  const source = read(route);
  assert.match(source, /requireUserManagementAccess/);
  assert.match(source, /status === 401 \? "Unauthorized" : "Forbidden"/);
}

const profilesRoute = read("app/api/profiles/route.ts");
assert.match(profilesRoute, /requireUserDirectoryAccess/);
assert.match(profilesRoute, /sanitizeModulesForRole/);
const usersPage = read("app/users/page.tsx");
assert.match(usersPage, /canViewUsers/);
assert.match(usersPage, /if \(!ownerLoading && canViewUsers\) load\(\)/);
assert.match(usersPage, /const canEditUsers = isOwner \|\| canViewUsers/);
assert.match(usersPage, /onClick=\{canEditUsers \? \(\) => openModal\(u\) : undefined\}/);
assert.match(usersPage, /m === "Users & Access" && \(isRestrictedRole \|\| !canManageUsers\)/);

const accessServer = read("lib/access-server.ts");
assert.match(accessServer, /requireUserProfileEditAccess/);
assert.match(accessServer, /requireUserManagementAccess/);
assert.match(accessServer, /can_manage_users/);
assert.match(accessServer, /canManageUsers\(role, profile\?\.can_manage_users\)/);
assert.match(accessServer, /const userManager = canManageUsers\(role, profile\?\.can_manage_users\)/);
assert.match(accessServer, /allowEditClientData: userManager \|\| profile\?\.allow_edit_client_data === true/);
assert.match(accessServer, /supabase\.auth\.getUser\(\)/);
assert.doesNotMatch(accessServer, /verifyDemoSession|tap_demo_session|tap_demo_user/);
const demoLoginRoute = read("app/api/demo-login/route.ts");
assert.match(demoLoginRoute, /status: 410/);
assert.doesNotMatch(demoLoginRoute, /TapHub2026|createDemoSession/);
const loginPage = read("app/login/page.tsx");
assert.doesNotMatch(loginPage, /api\/demo-login/);
assert.doesNotMatch(loginPage, /TapHub2026|TapHub2024|MaxHub2025/);
const proxy = read("proxy.ts");
assert.doesNotMatch(proxy, /tap_demo_session|tap_demo_user/);

const legacyAuth = read("lib/supabase/auth-user.ts");
assert.match(legacyAuth, /resolveAccessIdentity/);
assert.doesNotMatch(legacyAuth, /tap_demo_user/);
assert.doesNotMatch(legacyAuth, /tap_demo_email/);

const twoFactorStatus = read("app/api/2fa/status/route.ts");
assert.match(twoFactorStatus, /resolveAccessIdentity/);
assert.match(twoFactorStatus, /status: 401/);
assert.doesNotMatch(twoFactorStatus, /tap_demo_user/);
assert.doesNotMatch(twoFactorStatus, /tap_demo_email/);

const passwordRoute = read("app/api/profiles/[id]/password/route.ts");
assert.match(passwordRoute, /identity\.id\s*!==\s*id/);
assert.match(passwordRoute, /identity\.canManageUsers/);

const directoryRoute = read("app/api/profile-directory/route.ts");
assert.match(directoryRoute, /resolveAccessIdentity/);
assert.match(directoryRoute, /select\("id, full_name, role, location, reporting_manager, active"\)/);
for (const consumer of [
  "app/time/page.tsx",
  "app/workload/page.tsx",
  "components/client-slideover.tsx",
  "components/worklist-table.tsx",
]) {
  assert.match(read(consumer), /fetch\(["']\/api\/profile-directory["']\)/);
}

console.log("access-policy regression tests passed");
