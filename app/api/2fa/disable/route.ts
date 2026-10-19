import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/supabase/auth-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { cooldownMessage, generateAndStoreCode, sendCodeEmail, verifyCode } from "@/lib/email-2fa";

export async function POST(req: NextRequest) {
  const auth = await getAuthUser(req.headers.get("cookie") || "");
  if (!auth || !auth.user.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { user } = auth;
  // Use admin client (service_role key) for reads and writes to bypass RLS
  const adminSupabase = createAdminClient();

  const { data: profile } = await adminSupabase
    .from("profiles")
    .select("email_2fa_enabled")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.email_2fa_enabled) {
    return NextResponse.json({ error: "2FA not enabled" }, { status: 400 });
  }

  let body: { code?: string } = {};
  try { body = await req.json(); } catch {}

  // If code provided, verify and disable
  if (body.code) {
    const valid = await verifyCode(adminSupabase, user.id, body.code);
    if (!valid) {
      return NextResponse.json({ error: "Invalid or expired code" }, { status: 400 });
    }

    await adminSupabase
      .from("profiles")
      .update({
        email_2fa_enabled: false,
        email_2fa_code: null,
        email_2fa_code_expires_at: null,
      })
      .eq("id", user.id);

    return NextResponse.json({ success: true });
  }

  // No code — send challenge email first
  const result = await generateAndStoreCode(adminSupabase, user.id);
  if (result.error === "cooldown") {
    const message = cooldownMessage(result.retryAfterSeconds);
    return NextResponse.json({ error: message, message, retryAfterSeconds: result.retryAfterSeconds }, { status: 429 });
  }
  if (!result.ok) {
    console.error("disable: failed to store code:", result.error);
    return NextResponse.json({ error: "Failed to generate code. Try again." }, { status: 500 });
  }

  const sent = await sendCodeEmail(user.email, result.code, "disable");

  return NextResponse.json({
    sent,
    email: user.email,
    message: sent
      ? `Verification code sent to ${user.email}`
      : "Code generated (email not configured — set RESEND_API_KEY)",
  });
}
