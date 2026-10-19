/**
 * Where to go after signing in. Only a path on this site is accepted: an
 * absolute URL, a protocol-relative "//host" or a backslash form would let a
 * link send someone to another site straight after a real sign-in.
 */
export function safeNextPath(value: string | null | undefined, fallback = "/"): string {
  const next = String(value ?? "").trim();
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || /[\u0000-\u001f\\]/.test(next)) return fallback;
  return next;
}
