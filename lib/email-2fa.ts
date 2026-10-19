/**
 * 2FA email code helpers.
 * Functions accept a supabase client rather than creating their own.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { CODE_RESEND_COOLDOWN_MS, CODE_TTL_MS, MAX_CODE_ATTEMPTS, codeMatches, newCode, parseStoredCode, storedCode } from "@/lib/two-factor";

// Keep this aligned with the verified Resend sending domain.
export const TWO_FACTOR_FROM = "TAP Hub <security@email.aifusioniqlabs.com>";

/**
 * Generate a 6-digit code and store only its hash on the user's profile.
 * A new code is refused within CODE_RESEND_COOLDOWN_MS of the last one
 * (retryAfterSeconds is then set), so the email cannot be sent in a loop.
 */
export async function generateAndStoreCode(
  supabase: SupabaseClient<any, any, any>,
  userId: string,
): Promise<{ code: string; ok: boolean; error?: string; retryAfterSeconds?: number }> {
  const now = Date.now();
  const { data: current } = await supabase
    .from("profiles")
    .select("email_2fa_code_expires_at")
    .eq("id", userId)
    .maybeSingle();
  const lastExpiry = current?.email_2fa_code_expires_at ? new Date(current.email_2fa_code_expires_at).getTime() : NaN;
  const sentAt = lastExpiry - CODE_TTL_MS;
  if (Number.isFinite(sentAt) && now - sentAt < CODE_RESEND_COOLDOWN_MS) {
    return { code: "", ok: false, error: "cooldown", retryAfterSeconds: Math.ceil((CODE_RESEND_COOLDOWN_MS - (now - sentAt)) / 1000) };
  }

  const code = newCode();
  const { error } = await supabase
    .from("profiles")
    .update({
      email_2fa_code: storedCode(userId, code),
      email_2fa_code_expires_at: new Date(now + CODE_TTL_MS).toISOString(),
    })
    .eq("id", userId);

  if (error) {
    console.error("generateAndStoreCode error:", error.message);
    return { code: "", ok: false, error: error.message };
  }

  return { code, ok: true };
}

/** The response for a refused resend; the message is shown on the code screen. */
export function cooldownMessage(retryAfterSeconds = 30): string {
  return `A code was sent a moment ago. Check your email, or wait ${retryAfterSeconds} seconds to request another.`;
}

/**
 * Send the code to the user's email via Resend.
 */
export async function sendCodeEmail(
  toEmail: string,
  code: string,
  purpose: "setup" | "login" | "disable",
): Promise<boolean> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.warn("RESEND_API_KEY not set — 2FA email would not be sent");
    return false;
  }

  const subject =
    purpose === "setup"
      ? "Your TAP Hub verification code"
      : purpose === "disable"
        ? "Confirm disabling 2FA on TAP Hub"
        : "Your TAP Hub sign-in code";

  const html = `
    <div style="font-family: 'Public Sans', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #15803d; margin-bottom: 8px;">TAP Hub</h2>
      <p style="color: #666; font-size: 14px;">
        ${purpose === "setup" ? "Use this code to enable two-factor authentication:" : purpose === "disable" ? "Use this code to disable two-factor authentication:" : "Use this code to complete your sign-in:"}
      </p>
      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0;">
        <span style="font-family: monospace; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #15803d;">${code}</span>
      </div>
      <p style="color: #999; font-size: 12px;">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="color: #bbb; font-size: 11px;">TAP Associates, LLC &mdash; Client Hub</p>
    </div>
  `;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
        "User-Agent": "TAP-Hub/1.0",
      },
      body: JSON.stringify({
        from: TWO_FACTOR_FROM,
        to: toEmail,
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("Resend error:", err);
      return false;
    }
    return true;
  } catch (e) {
    console.error("Failed to send email:", e);
    return false;
  }
}

/**
 * Verify a code against the stored hash (within expiry). Every guess is counted
 * before it is compared, with a compare-and-set on the stored value, so parallel
 * guesses cannot exceed MAX_CODE_ATTEMPTS; after that the code is discarded.
 * Codes are never logged.
 */
export async function verifyCode(
  supabase: SupabaseClient<any, any, any>,
  userId: string,
  code: string,
): Promise<boolean> {
  const input = String(code ?? "").trim();
  if (!/^\d{6}$/.test(input)) return false;

  const { data: profile } = await supabase
    .from("profiles")
    .select("email_2fa_code, email_2fa_code_expires_at")
    .eq("id", userId)
    .maybeSingle();

  if (!profile?.email_2fa_code || !profile?.email_2fa_code_expires_at) return false;
  if (new Date(profile.email_2fa_code_expires_at) < new Date()) return false;

  const stored = String(profile.email_2fa_code);
  const parsed = parseStoredCode(stored);
  if (!parsed || parsed.attempts >= MAX_CODE_ATTEMPTS) {
    // Unreadable (for example a pre-hash code) or used up: discard it so a new one must be requested.
    await supabase.from("profiles").update({ email_2fa_code: null, email_2fa_code_expires_at: null }).eq("id", userId).eq("email_2fa_code", stored);
    return false;
  }

  const counted = `v1:${parsed.hash}:${parsed.attempts + 1}`;
  const { data: claimed } = await supabase
    .from("profiles")
    .update({ email_2fa_code: counted })
    .eq("id", userId)
    .eq("email_2fa_code", stored)
    .select("id");
  if (!claimed || claimed.length === 0) return false;

  return codeMatches(userId, input, parsed.hash);
}
