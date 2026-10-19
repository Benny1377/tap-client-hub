import { NextResponse } from "next/server";
import { findActiveProfileForLogin } from "@/lib/login-identity";
import { createTicket } from "@/lib/support/create-ticket";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * POST /api/forgot-password  { identifier }
 *
 * Passwords are reset by the firm's admins, not by email link: this files a
 * support ticket for them. The answer is the same whether or not the account
 * exists, so the form cannot be used to find out who has an account, and a
 * ticket is filed only for a real, active account.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const identifier = typeof body?.identifier === "string" ? body.identifier.trim() : "";
  if (!identifier || identifier.length > 254) {
    return NextResponse.json({ error: "Enter your username or email address." }, { status: 400, headers: NO_STORE });
  }

  try {
    const profile = await findActiveProfileForLogin(identifier);
    if (profile) {
      const result = await createTicket({
        sourceAppKey: "tap-hub",
        title: "Password reset request",
        description: `${profile.full_name || "A user"} asked for a password reset from the sign-in page. Reset it in Users & Access after confirming it was them.`,
        reporter: { name: profile.full_name || "TAP Hub user", email: profile.email },
        priority: "normal",
        category: "Signing in / access",
        tapProfileId: profile.id,
      });
      if (result.ok === false) {
        console.error("[forgot-password] ticket was not created", { status: result.status });
        return NextResponse.json({ error: "Unable to send the request right now. Please contact support." }, { status: 503, headers: NO_STORE });
      }
    }
  } catch (error) {
    console.error("[forgot-password] lookup failed", { message: error instanceof Error ? error.message.slice(0, 240) : "unknown" });
    return NextResponse.json({ error: "Unable to send the request right now. Please contact support." }, { status: 503, headers: NO_STORE });
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
