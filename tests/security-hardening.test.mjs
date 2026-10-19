import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

process.env.TWO_FACTOR_SECRET = "test-only-two-factor-secret";

const twoFactor = await import("../lib/two-factor.ts");
const { safeNextPath } = await import("../lib/safe-next.ts");
const { commentAuthor, alreadyStored } = await import("../lib/comment-authors.ts");
const { passwordProblem, MIN_PASSWORD_LENGTH } = await import("../lib/password-policy.ts");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const USER = "00000000-0000-4000-8000-000000000001";

test("2FA codes are six random digits, stored only as a hash, and checked exactly", () => {
  for (let i = 0; i < 200; i++) assert.match(twoFactor.newCode(), /^\d{6}$/);
  const code = "042817";
  const stored = twoFactor.storedCode(USER, code);
  assert.doesNotMatch(stored, /042817/, "the code itself is never stored");
  const parsed = twoFactor.parseStoredCode(stored);
  assert.equal(parsed.attempts, 0);
  assert.equal(twoFactor.codeMatches(USER, code, parsed.hash), true);
  assert.equal(twoFactor.codeMatches(USER, "042818", parsed.hash), false);
  assert.equal(twoFactor.codeMatches("00000000-0000-4000-8000-000000000002", code, parsed.hash), false, "a hash is bound to its user");
  assert.equal(twoFactor.parseStoredCode("123456"), null, "an old plain-text code is not accepted");
  assert.equal(twoFactor.MAX_CODE_ATTEMPTS, 5);
});

test("the 2FA cookie is signed, bound to the profile and expires", () => {
  const now = Date.UTC(2026, 9, 19);
  const value = twoFactor.twoFactorCookieValue(USER, now);
  assert.equal(twoFactor.twoFactorCookieValid(value, USER, now), true);
  assert.equal(twoFactor.twoFactorCookieValid(value, "00000000-0000-4000-8000-000000000002", now), false, "another profile");
  assert.equal(twoFactor.twoFactorCookieValid(`${value}x`, USER, now), false, "tampered signature");
  const [id, , signature] = value.split(".");
  assert.equal(twoFactor.twoFactorCookieValid(`${id}.${Math.floor(now / 1000) + 10 ** 8}.${signature}`, USER, now), false, "extended expiry");
  assert.equal(twoFactor.twoFactorCookieValid(value, USER, now + (twoFactor.TWO_FACTOR_COOKIE_MAX_AGE + 1) * 1000), false, "expired");
  assert.equal(twoFactor.twoFactorCookieValid(undefined, USER, now), false);
  assert.equal(twoFactor.twoFactorCookieOptions.httpOnly, true);
});

test("after sign-in, only paths on this site are followed", () => {
  for (const ok of ["/", "/collections", "/billing?tab=invoices", "/clients#top"]) assert.equal(safeNextPath(ok), ok);
  for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "\\\\evil.example", "javascript:alert(1)", "evil", "", null, undefined, "/ok\\..\\x"]) {
    assert.equal(safeNextPath(bad), "/", String(bad));
  }
});

test("existing comments keep their stored author; new ones go to the signed-in user", () => {
  const stored = new Map([["item-1|3|Filed on time|1760000000000", "Lizette"]]);
  const old = { month: 3, text: "Filed on time", createdAt: new Date(1760000000000).toISOString(), author: "Spoofed" };
  assert.equal(commentAuthor(stored, "item-1", old, "Signed In"), "Lizette");
  assert.equal(commentAuthor(stored, "item-1", { month: 3, text: "New note", createdAt: new Date().toISOString(), author: "Tushar" }, "Signed In"), "Signed In");
  assert.equal(alreadyStored([{ created_at: "2025-10-09T08:53:20+00:00", author_label: "Lizette" }], { createdAt: "2025-10-09T08:53:20.000Z", author: "x" }), true, "same time in another format");
  assert.equal(alreadyStored([{ created_at: "2025-10-09T08:53:20+00:00", author_label: "Lizette" }], { createdAt: "2026-01-01T00:00:00Z", author: "Tushar" }), false);
});

test("passwords need at least twelve characters", () => {
  assert.equal(MIN_PASSWORD_LENGTH, 12);
  assert.ok(passwordProblem("short"));
  assert.equal(passwordProblem("a-long-enough-pass"), null);
});

test("debug, migration and email-lookup routes are gone", () => {
  for (const route of ["app/api/debug-2fa/route.ts", "app/api/migrate/route.ts", "app/api/migrate-2fa/route.ts", "app/api/auth/resolve-login/route.ts", "lib/demo-session.ts"]) {
    assert.equal(existsSync(new URL(`../${route}`, import.meta.url)), false, route);
  }
});

test("worklist and workload routes check the caller before using the service role", () => {
  for (const route of ["app/api/period-counts/route.ts", "app/api/work-periods/route.ts"]) {
    const source = read(route);
    for (const handler of ["GET", "POST"]) {
      const body = source.slice(source.indexOf(`export async function ${handler}(`));
      const guard = handler === "GET" ? "requireClientDataReadAccess()" : "requireClientDataEditAccess()";
      assert.ok(body.indexOf(guard) > 0 && body.indexOf(guard) < body.indexOf("createAdminClient()"), `${route} ${handler}`);
    }
  }
  const workload = read("app/api/workload/route.ts");
  assert.ok(workload.indexOf("resolveAccessIdentity()") < workload.indexOf("await createClient()"));
  assert.match(workload, /identity\.modules\.includes\("Workload"\)/);
});

test("2FA is enforced on the server and codes are never logged", () => {
  const access = read("lib/access-server.ts");
  assert.match(access, /email_2fa_enabled/);
  assert.match(access, /twoFactorCookieValid\(/);
  assert.match(access, /if \(session\.twoFactorPending && !options\.allowPendingTwoFactor\) return null;/);
  const challenge = read("app/api/2fa/challenge/route.ts");
  assert.match(challenge, /allowPendingTwoFactor: true/);
  assert.match(challenge, /response\.cookies\.set\(TWO_FACTOR_COOKIE/);
  assert.doesNotMatch(challenge, /console\.log/);
  const email2fa = read("lib/email-2fa.ts");
  assert.doesNotMatch(email2fa, /Math\.random/);
  assert.doesNotMatch(email2fa, /stored=|input=|console\.(log|warn)\([^)]*code/i);
  assert.match(read("app/api/auth/sign-in/route.ts"), /response\.cookies\.delete\(TWO_FACTOR_COOKIE\)/);
  assert.match(read("app/api/demo-login/route.ts"), /response\.cookies\.delete\(TWO_FACTOR_COOKIE\)/);
  assert.match(read("proxy.ts"), /searchParams\.get\("step"\) !== "2fa"/);
  for (const route of ["app/api/2fa/disable/route.ts", "app/api/2fa/verify/route.ts", "app/api/2fa/setup/route.ts"]) {
    assert.doesNotMatch(read(route), /allowPendingTwoFactor/, `${route} needs a fully verified session`);
  }
});

test("user managers cannot take over Owner/Admin accounts; own password changes need the current one", () => {
  const profiles = read("app/api/profiles/route.ts");
  assert.match(profiles, /!isPowerUser\(access\.identity!\.role\) && isPowerUser\(role\)/, "create");
  assert.match(profiles, /isPowerUser\(\(targetRoleRow as \{ role\?: string \| null \}\)\.role\) \|\| \(role !== undefined && isPowerUser\(role\)\)/, "edit");
  assert.match(read("app/api/profiles/[id]/route.ts"), /!isPowerUser\(access\.identity!\.role\) && isPowerUser\(profile\.role\)/, "delete");
  const password = read("app/api/profiles/[id]/password/route.ts");
  assert.match(password, /currentPasswordMatches\(identity\.email, currentPassword\)/);
  assert.match(password, /!isPowerUser\(identity\.role\) && isPowerUser\(profile\.role\)/);
  assert.match(read("app/settings/page.tsx"), /currentPassword/);
});

test("sign-in never returns an email; the forgot-password form files a ticket without revealing accounts", () => {
  assert.match(read("app/api/auth/sign-in/route.ts"), /resolveLoginEmail\(/);
  assert.doesNotMatch(read("app/login/page.tsx"), /resolve-login/);
  const forgot = read("app/api/forgot-password/route.ts");
  assert.match(forgot, /findActiveProfileForLogin\(/);
  assert.match(forgot, /return NextResponse\.json\(\{ ok: true \}/);
  assert.doesNotMatch(forgot, /email: profile\.email[^,]*\}, \{ headers/);
});

test("no quiet fallback to the anon key or a hardcoded Supabase host", () => {
  assert.doesNotMatch(read("lib/supabase/admin.ts"), /SUPABASE_SERVICE_ROLE_KEY \|\|/);
  for (const file of ["lib/supabase/server.ts", "lib/supabase/auth-user.ts"]) assert.doesNotMatch(read(file), /mom-ai-agency/);
});

test("comment authors and vault permissions come from the server", () => {
  const clients = read("app/api/clients/route.ts");
  assert.doesNotMatch(clients, /author_label: (cm|c)\.author/);
  assert.match(clients, /const actorName = access\.identity!\.name;/);
  assert.doesNotMatch(read("components/worklist-table.tsx"), /tap_demo_email/);
  assert.doesNotMatch(read("components/client-slideover.tsx"), /tap_demo_email/);
  const vault = read("app/vault/page.tsx");
  assert.doesNotMatch(vault, /Unlock \(demo\)|setUserRole\("admin"\)/);
  assert.match(vault, /me\.allowEditClientData === true/);
  assert.match(read("app/api/time-entries/route.ts"), /You may only edit your own time entries/);
});

test("baseline security headers are set and no real data files are tracked", () => {
  const config = read("next.config.ts");
  for (const header of ["X-Frame-Options", "X-Content-Type-Options", "Referrer-Policy", "frame-ancestors 'self'"]) assert.ok(config.includes(header), header);
  assert.doesNotMatch(read("supabase/migrations/007_insert_credentials.sql"), /insert into/i);
  for (const path of ["backups/credentials_20260708_224919.csv", "docs/datamodel/csv_dataset/credentials.csv"]) {
    assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), false, path);
  }
  assert.doesNotMatch(read("lib/data.ts"), /password:\s*"/, "no seed vault logins");
});
