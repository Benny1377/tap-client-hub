import { createHash } from "node:crypto";

export type ProviderResult =
  | { status: "accepted"; reason: null; messageId: string }
  | { status: "failed"; reason: "PROVIDER_RATE_LIMITED" | "PROVIDER_TEMPORARY_FAILURE" | "PROVIDER_REJECTED"; messageId: null }
  | { status: "needs_review"; reason: "PROVIDER_OUTCOME_UNKNOWN"; messageId: null };

export type ResendEmailRequest = {
  apiKey: string;
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
};

function resendPayload(input: ResendEmailRequest) {
  return {
    from: input.from,
    to: [input.to],
    ...(input.replyTo ? { reply_to: input.replyTo } : {}),
    subject: input.subject,
    html: input.html,
    text: input.text,
  };
}

export function resendPayloadFingerprint(input: ResendEmailRequest) {
  return createHash("sha256").update(JSON.stringify(resendPayload(input))).digest("hex");
}

/**
 * Thin server-side provider boundary. Injecting fetch lets tests exercise every
 * provider response without credentials or an actual network request.
 */
export async function sendResendEmail(input: ResendEmailRequest, fetcher: typeof fetch = fetch): Promise<ProviderResult> {
  let response: Response;
  try {
    response = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify(resendPayload(input)),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return { status: "needs_review", reason: "PROVIDER_OUTCOME_UNKNOWN", messageId: null };
  }

  if (response.status === 429) return { status: "failed", reason: "PROVIDER_RATE_LIMITED", messageId: null };
  if (response.status >= 500) return { status: "failed", reason: "PROVIDER_TEMPORARY_FAILURE", messageId: null };
  if (!response.ok) return { status: "failed", reason: "PROVIDER_REJECTED", messageId: null };

  try {
    const result = await response.json() as { id?: unknown };
    return typeof result.id === "string" && result.id.length > 0
      ? { status: "accepted", reason: null, messageId: result.id }
      : { status: "needs_review", reason: "PROVIDER_OUTCOME_UNKNOWN", messageId: null };
  } catch {
    return { status: "needs_review", reason: "PROVIDER_OUTCOME_UNKNOWN", messageId: null };
  }
}
