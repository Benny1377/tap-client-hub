import type { CollectionsDeliveryMissingSetting, CollectionsDeliveryStatusResponse } from "@/lib/collections-api";
import { createAdminClient } from "@/lib/supabase/admin";

const MESSAGES: Record<string, string> = {
  ACTIVE_HOLD: "On hold; no email sent.",
  UNALLOCATED_CREDIT_REVIEW: "Credit/payment needs review.",
  CONTACT_REVIEW_REQUIRED: "Choose one primary contact with an email.",
  EMAIL_CONTACT_MISSING: "No client email is available.",
  BELOW_MINIMUM_BALANCE: "Balance is below the configured minimum.",
  RULE_DISABLED: "This reminder stage is turned off.",
  APPROVAL_REQUIRED: "Owner/Admin approval is required.",
  ATTEMPT_ALREADY_EXISTS: "This invoice stage already has an attempt.",
  DELIVERY_DISABLED: "Email delivery is disabled.",
  PROVIDER_KEY_MISSING: "Email provider is not configured.",
  SENDER_NOT_VERIFIED: "Sender address is not verified.",
  TEST_RECIPIENT_MISSING: "Test mailbox is not configured.",
  SYNTHETIC_DATA_REQUIRED: "This test send requires a synthetic fixture.",
  PROVIDER_RATE_LIMITED: "Email provider is temporarily rate-limiting requests.",
  PROVIDER_TEMPORARY_FAILURE: "Email provider temporarily failed.",
  PROVIDER_REJECTED: "Email provider rejected the request.",
  PROVIDER_OUTCOME_UNKNOWN: "Provider outcome is unknown; review before retrying.",
  ATTEMPT_LIMIT_REACHED: "Retry limit reached.",
};

export function deliveryReasonText(code: string | null | undefined) {
  return code ? MESSAGES[code] || null : null;
}

export function isRetryableDelivery(code: string | null | undefined, count: number) {
  return count < 5 && (code === "PROVIDER_RATE_LIMITED" || code === "PROVIDER_TEMPORARY_FAILURE");
}

function maskedAddress(value: string | undefined) {
  if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null;
  const [name, domain] = value.split("@");
  return `${name.slice(0, 1)}${"*".repeat(Math.max(2, Math.min(8, name.length - 1)))}@${domain}`;
}

function environmentAllowlisted() {
  if (process.env.COLLECTIONS_NON_PRODUCTION !== "true") return false;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  try {
    const host = new URL(url).hostname;
    if (host === "localhost" || host === "127.0.0.1") return true;
    const projectRef = host.split(".")[0];
    return Boolean(projectRef && process.env.COLLECTIONS_ALLOWED_PROJECT_REF && projectRef === process.env.COLLECTIONS_ALLOWED_PROJECT_REF);
  } catch { return false; }
}

export async function getDeliveryStatus(): Promise<CollectionsDeliveryStatusResponse | null> {
  const db = createAdminClient();
  const { data: settings, error } = await db.from("collection_settings")
    .select("automation_enabled, delivery_mode, test_recipient").eq("id", "default").maybeSingle();
  if (error || !settings) return null;

  const missing: CollectionsDeliveryMissingSetting[] = [];
  const testMode = process.env.COLLECTIONS_MODE === "test" && settings.delivery_mode === "test";
  if (!testMode) missing.push("DELIVERY_DISABLED");
  const automationEnabled = settings.automation_enabled === true && process.env.COLLECTIONS_AUTOMATION_KILL_SWITCH !== "true";
  if (!automationEnabled) missing.push("AUTOMATION_PAUSED");
  if (!process.env.COLLECTIONS_RESEND_API_KEY) missing.push("PROVIDER_KEY_MISSING");
  if (process.env.COLLECTIONS_SENDER_VERIFIED !== "true" || !process.env.COLLECTIONS_SENDER_EMAIL) missing.push("SENDER_NOT_VERIFIED");
  if (!process.env.COLLECTIONS_REPLY_TO) missing.push("REPLY_TO_MISSING");
  const recipient = process.env.COLLECTIONS_TEST_RECIPIENT || "";
  if (!maskedAddress(recipient)) missing.push("TEST_RECIPIENT_MISSING");
  if (!environmentAllowlisted()) missing.push("ENVIRONMENT_NOT_ALLOWLISTED");
  return {
    mode: testMode ? "test" : "disabled",
    automation_enabled: automationEnabled,
    test_ready: missing.length === 0,
    missing: [...new Set(missing)],
    test_recipient_masked: maskedAddress(recipient),
  };
}

export function isSyntheticOnlyEnabled() {
  return environmentAllowlisted() && process.env.COLLECTIONS_MODE === "test";
}
