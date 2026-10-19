import { NextResponse } from "next/server";
import { resolveAccessSession } from "@/lib/access-server";
import { authContext, authRequestId } from "@/lib/auth-debug";

export const dynamic = "force-dynamic";

/** The only client-facing authority for role and module access. */
export async function GET(request: Request) {
  const requestId = authRequestId(request);
  const context = authContext(requestId);
  const startedAt = Date.now();
  try {
    const { identity, twoFactorPending } = await resolveAccessSession();
    if (identity && twoFactorPending) {
      return NextResponse.json({ error: "Two-factor verification required", code: "TWO_FACTOR_REQUIRED", twoFactorRequired: true, requestId }, { status: 401, headers: { "x-auth-request-id": requestId } });
    }
    if (!identity) {
      console.warn("[auth.me] unauthorized", { ...context, elapsedMs: Date.now() - startedAt });
      return NextResponse.json({ error: "Unauthorized", role: "staff", modules: [], canManageUsers: false, requestId }, { status: 401, headers: { "x-auth-request-id": requestId } });
    }

    console.info("[auth.me] success", { ...context, role: identity.role, moduleCount: identity.modules.length, identityIdPresent: Boolean(identity.id), elapsedMs: Date.now() - startedAt });
    return NextResponse.json({
      id: identity.id,
      email: identity.email,
      name: identity.name,
      role: identity.role,
      modules: identity.modules,
      canManageUsers: identity.canManageUsers,
      allowEditClientData: identity.allowEditClientData,
      requestId,
    }, { headers: { "x-auth-request-id": requestId } });
  } catch (error) {
    console.error("[auth.me] unhandled failure", { ...context, error: error instanceof Error ? { name: error.name, message: error.message.slice(0, 240) } : { message: String(error).slice(0, 240) }, elapsedMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unable to load session", requestId }, { status: 500, headers: { "x-auth-request-id": requestId } });
  }
}
