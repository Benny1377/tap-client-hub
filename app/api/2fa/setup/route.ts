import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/supabase/auth-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { cooldownMessage, generateAndStoreCode, sendCodeEmail } from "@/lib/email-2fa";

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

  if (profile?.email_2fa_enabled) {
    return NextResponse.json({ error: "2FA is already enabled" }, { status: 400 });
  }

  const result = await generateAndStoreCode(adminSupabase, user.id);
  if (result.error === "cooldown") {
    const message = cooldownMessage(result.retryAfterSeconds);
    return NextResponse.json({ error: message, message, retryAfterSeconds: result.retryAfterSeconds }, { status: 429 });
  }
  if (!result.ok) {
    console.error("setup: failed to store code:", result.error);
    return NextResponse.json({ error: "Failed to generate code. Try again." }, { status: 500 });
  }

  const sent = await sendCodeEmail(user.email, result.code, "setup");

  return NextResponse.json({
    sent,
    email: user.email,
    message: sent
      ? `Verification code sent to ${user.email}`
      : "Code generated, but the verification email could not be sent. Please try again or contact support.",
  });
}
