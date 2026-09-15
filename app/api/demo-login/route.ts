import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createDemoSession } from "@/lib/demo-session";
import { authContext, authError, authRequestId } from "@/lib/auth-debug";

// Temporary onboarding credential. Keep this server-side and remove the
// fallback after every active user has selected a personal password.
const TEMP_PASSWORD = "TapHub2026!";
const LEGACY_DEMO_USERS: Record<string, string> = {
  "mmatronin@gmail.com": "Max Matronin",
  "ben@aifusioniqlabs.com": "Ben",
  "staff@tapallc.com": "Staff Test",
};

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 86400,
};

export async function POST(request: NextRequest) {
  const requestId = authRequestId(request);
  const context = authContext(requestId);
  const startedAt = Date.now();
  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch (error) {
    console.warn("[auth.demo-login] invalid JSON", { ...context, error: authError(error) });
    return NextResponse.json({ error: "Invalid request", requestId }, { status: 400, headers: { "x-auth-request-id": requestId } });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  console.info("[auth.demo-login] start", { ...context, emailDomain: email.includes("@") ? email.split("@").pop() : "missing", emailLength: email.length, passwordProvided: password.length > 0 });
  if (password !== TEMP_PASSWORD) {
    console.warn("[auth.demo-login] password rejected", { ...context, emailDomain: email.includes("@") ? email.split("@").pop() : "missing", elapsedMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Invalid email or password", requestId }, { status: 401, headers: { "x-auth-request-id": requestId } });
  }

  try {
    const admin = createAdminClient();
    const { data: profile, error } = await admin
      .from("profiles")
      .select("full_name,email,active")
      .ilike("email", email)
      .eq("active", true)
      .maybeSingle();
    if (error) {
      console.error("[auth.demo-login] profile query failed", { ...context, error: authError(error), elapsedMs: Date.now() - startedAt });
      return NextResponse.json({ error: "Unable to sign in right now.", requestId }, { status: 500, headers: { "x-auth-request-id": requestId } });
    }

    const name = profile?.full_name || LEGACY_DEMO_USERS[email];
    if (!name) {
      console.warn("[auth.demo-login] active profile not found", { ...context, emailDomain: email.includes("@") ? email.split("@").pop() : "missing", elapsedMs: Date.now() - startedAt });
      return NextResponse.json({ error: "Invalid email or password", requestId }, { status: 401, headers: { "x-auth-request-id": requestId } });
    }

    // Do not let the generic fallback continue working for users who have
    // already chosen a personal Auth password. The Auth check is deliberately
    // password-verification-only: no session from this probe is used.
    const { data: authUsers, error: authListError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (authListError) {
      console.error("[auth.demo-login] auth account lookup failed", { ...context, error: authError(authListError), elapsedMs: Date.now() - startedAt });
      return NextResponse.json({ error: "Unable to sign in right now.", requestId }, { status: 500, headers: { "x-auth-request-id": requestId } });
    }
    const authUserList = (authUsers as unknown as { users: Array<{ email?: string | null }> }).users || [];
    const authUser = authUserList.find((user) => user.email?.trim().toLowerCase() === email);
    if (authUser) {
      const authProbe = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { db: { schema: "tap_hub_project" } });
      const { error: passwordError } = await authProbe.auth.signInWithPassword({ email, password: TEMP_PASSWORD });
      if (passwordError) {
        console.info("[auth.demo-login] generic fallback disabled after personal password", { ...context, emailDomain: email.split("@").pop(), elapsedMs: Date.now() - startedAt });
        return NextResponse.json({ error: "Invalid email or password", requestId }, { status: 401, headers: { "x-auth-request-id": requestId } });
      }
    }

    const response = NextResponse.json({ ok: true, name, email, mustChangePassword: true, requestId });
    response.cookies.set("tap_demo_session", createDemoSession(email, name), COOKIE_OPTIONS);
    response.cookies.set("tap_demo_user", name, COOKIE_OPTIONS);
    response.cookies.set("tap_demo_email", email, COOKIE_OPTIONS);
    response.cookies.set("tap_force_password", "1", COOKIE_OPTIONS);
    response.cookies.delete("tap_demo_role");
    response.cookies.delete("tap_modules");
    console.info("[auth.demo-login] success", { ...context, profileFound: Boolean(profile), elapsedMs: Date.now() - startedAt });
    response.headers.set("x-auth-request-id", requestId);
    return response;
  } catch (error) {
    console.error("[auth.demo-login] unhandled failure", { ...context, error: authError(error), elapsedMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unable to sign in right now.", requestId }, { status: 500, headers: { "x-auth-request-id": requestId } });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete("tap_demo_session");
  response.cookies.delete("tap_demo_user");
  response.cookies.delete("tap_demo_email");
  response.cookies.delete("tap_demo_role");
  response.cookies.delete("tap_modules");

  // Supabase SSR stores sessions in HttpOnly cookies and may split large
  // sessions across sb-<project>-auth-token.0, .1, etc. Browser JavaScript
  // cannot clear those cookies, so remove every matching chunk server-side.
  const cookieStore = await cookies();
  for (const cookie of cookieStore.getAll()) {
    if (cookie.name.startsWith("sb-") || cookie.name.startsWith("supabase")) {
      response.cookies.set(cookie.name, "", { httpOnly: true, expires: new Date(0), path: "/" });
    }
  }
  return response;
}
