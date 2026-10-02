import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), "utf8");

const profilesRoute = read("app/api/profiles/route.ts");
const deleteRoute = read("app/api/profiles/[id]/route.ts");
const accessServer = read("lib/access-server.ts");
const usersPage = read("app/users/page.tsx");

// ── Directory read must respect authorization and bypass RLS safely ──
const getHandler = profilesRoute.slice(
  profilesRoute.indexOf("export async function GET"),
  profilesRoute.indexOf("export async function POST"),
);
assert.ok(getHandler.indexOf("requireUserDirectoryAccess()") < getHandler.indexOf("createAdminClient()"), "directory access must be authorized before using the service-role client");
assert.match(getHandler, /if \(!process\.env\.SUPABASE_SERVICE_ROLE_KEY\)/, "missing service-role configuration must fail visibly instead of returning an empty directory");
assert.match(getHandler, /await adminSupabase\s*\.from\("profiles"\)/, "directory profile query must use the authorized admin client to bypass RLS");

// ── Endpoint wiring ──
// Ordinary managers can only reach PATCH. POST and DELETE stay behind the
// explicit user-management capability.
assert.match(profilesRoute, /requireUserProfileEditAccess\(\)/, "PATCH must use the manager-aware edit guard");
assert.match(profilesRoute, /requireUserManagementAccess\(\)/, "POST must require explicit user-management access");
assert.match(deleteRoute, /requireUserManagementAccess\(\)/, "DELETE must require explicit user-management access");

// User provisioning is an authenticated administrative action. Public sign-up is
// disabled in production, so POST must use the service-role Auth Admin API and
// clean up the Auth account if the profile insert fails.
const postHandler = profilesRoute.slice(
  profilesRoute.indexOf("export async function POST"),
  profilesRoute.indexOf("// ── Also add PATCH"),
);
assert.doesNotMatch(postHandler, /\.auth\.signUp\(/, "POST must not depend on public Supabase sign-up");
assert.match(postHandler, /createAdminClient\(\)/, "POST must create a service-role client");
assert.match(postHandler, /\.auth\.admin\.createUser\(/, "POST must provision through the Auth Admin API");
assert.match(postHandler, /email_confirm:\s*true/, "provisioned users must be able to sign in with the initial password");
assert.match(postHandler, /\.auth\.admin\.deleteUser\(authData\.user\.id\)/, "profile failure must roll back the Auth user");

// ── Access-server guard ──
// Managers with Users & Access get edit access. A manager with an explicit
// can_manage_users grant gets the full user-management surface.
assert.match(accessServer, /export async function requireUserProfileEditAccess/);
assert.match(accessServer, /identity\.role === "manager" && identity\.modules\.includes\("Users & Access"\)/);
assert.match(accessServer, /identity\.canManageUsers/);
assert.match(accessServer, /canManageUsers\(role, profile\?\.can_manage_users\)/);
assert.match(accessServer, /allowEditClientData: userManager \|\| profile\?\.allow_edit_client_data === true/);

// ── Manager edit branch is an explicit, safe allowlist ──
// Slice out the manager branch (from `if (isManagerEdit)` up to the owner/admin comment)
// and prove it never writes privileged fields.
const managerBranch = profilesRoute.slice(
  profilesRoute.indexOf("if (isManagerEdit)"),
  profilesRoute.indexOf("// ── Owner/Admin full edit"),
);
assert.ok(managerBranch.length > 0, "manager edit branch must exist in PATCH handler");
assert.match(managerBranch, /isPowerUser\(targetRole\)/, "manager branch must refuse Owner/Admin targets");
assert.match(managerBranch, /Managers cannot edit Owner\/Admin accounts/);
assert.match(managerBranch, /sanitizeManagerModules\(targetRole, target\.modules, modules\)/);
assert.match(managerBranch, /updateData\.full_name/);
assert.match(managerBranch, /updateData\.location/);
assert.match(managerBranch, /updateData\.reporting_manager/);
assert.doesNotMatch(managerBranch, /updateData\.(role|email|active|invite_status|password|email_2fa_enabled|allow_edit_client_data)/, "manager branch must not write privileged/auth fields");

// ── UI wiring ──
// A manager with Users & Access can open the existing edit modal. The explicit
// server-derived capability unlocks add/delete without relying on the role label.
assert.match(usersPage, /const canEditUsers = isOwner \|\| canViewUsers/);
assert.match(usersPage, /onClick=\{canEditUsers \? \(\) => openModal\(u\) : undefined\}/);
assert.match(usersPage, /canManageUsers\?: boolean/);
assert.match(usersPage, /const canManageUsers = isOwner \|\| currentUser\?\.canManageUsers === true/);
assert.match(usersPage, /\{canManageUsers && <div style=\{\{ display: "flex", justifyContent: "flex-end"/, "Add user button follows the explicit management capability");
assert.match(usersPage, /\{canManageUsers && modalUser !== "new" && !deleteConfirm && \(/, "Delete action follows the explicit management capability");

// The modal footer must remain visible while a long user form scrolls. The
// action handlers and persistence API are unchanged - only the layout splits
// into a scrolling form body and non-scrolling footer.
assert.match(usersPage, /maxHeight: "calc\(100dvh - 32px\)"/);
assert.match(usersPage, /overflow: "hidden", display: "flex", flexDirection: "column"/);
assert.match(usersPage, /className="mform" style=\{\{ padding: "18px 24px", overflowY: "auto", flex: 1, minHeight: 0 \}\}/);
assert.match(usersPage, /borderTop: "1px solid var\(--line\)", flexShrink: 0/);

console.log("manager user edit regression checks passed");
