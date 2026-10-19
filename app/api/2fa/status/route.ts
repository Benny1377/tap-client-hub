import { NextResponse } from "next/server";
import { resolveAccessSession } from "@/lib/access-server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // The login page asks this between the password and code steps, so it reports
    // the half-signed-in state instead of treating it as signed out.
    const { identity, twoFactorPending } = await resolveAccessSession();
    if (!identity) {
      return NextResponse.json(
        { enabled: false, authenticated: false },
        { status: 401 }
      );
    }

    const { data: profile, error } = await createAdminClient()
      .from("profiles")
      .select("email_2fa_enabled")
      .eq("id", identity.id)
      .maybeSingle();

    if (error) throw error;

    return NextResponse.json({
      enabled: profile?.email_2fa_enabled ?? false,
      authenticated: true,
      verified: !twoFactorPending,
    });
  } catch (error) {
    console.error("2FA status error:", error);
    return NextResponse.json(
      { enabled: false, authenticated: false },
      { status: 500 }
    );
  }
}