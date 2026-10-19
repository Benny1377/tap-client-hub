import { cookies } from "next/headers";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageUsers, effectiveModules, isPowerUser, normalizeRole } from "@/lib/access-policy";
import { TWO_FACTOR_COOKIE, twoFactorCookieValid } from "@/lib/two-factor";

type Profile = { id: string; full_name?: string | null; email?: string | null; role?: string | null; modules?: unknown; location?: string | null; active?: boolean | null; can_manage_users?: boolean | null; allow_edit_client_data?: boolean | null; email_2fa_enabled?: boolean | null };

export type AccessIdentity = {
  id: string;
  email: string;
  name: string;
  role: string;
  modules: string[];
  canManageUsers: boolean;
  allowEditClientData: boolean;
  authenticated: boolean;
};

export type AccessSession = { identity: AccessIdentity | null; twoFactorPending: boolean };

/**
 * The signed-in identity. An account with 2FA on counts as signed out until this
 * browser holds a valid 2FA cookie for it; only the 2FA routes themselves pass
 * allowPendingTwoFactor, so they can send and check the code.
 */
export async function resolveAccessIdentity(options: { allowPendingTwoFactor?: boolean } = {}): Promise<AccessIdentity | null> {
  const session = await resolveAccessSession();
  if (session.twoFactorPending && !options.allowPendingTwoFactor) return null;
  return session.identity;
}

export async function resolveAccessSession(): Promise<AccessSession> {
  const signedOut = { identity: null, twoFactorPending: false };
  let authUser: { id: string; email?: string } | null = null;
  const supabase = await createServerClient();

  try {
    const { data } = await supabase.auth.getUser();
    authUser = data.user ? { id: data.user.id, email: data.user.email } : null;
  } catch { /* unauthenticated requests remain unauthorized */ }

  if (!authUser) return signedOut;

  const id = authUser?.id || "";
  const email = (authUser.email || "").toLowerCase();
  const admin = createAdminClient();
  let profile: Profile | null = null;

  const profileColumns = "id, full_name, email, role, modules, location, active, can_manage_users, allow_edit_client_data, email_2fa_enabled";
  async function findProfile(client: typeof admin) {
    if (id) {
      const { data } = await client.from("profiles").select(profileColumns).eq("id", id).maybeSingle();
      if (data) return data as Profile;
    }
    if (email) {
      const { data: profiles } = await client.from("profiles").select(profileColumns);
      const match = (profiles || []).find((candidate: Profile) => String(candidate.email || "").trim().toLowerCase() === email);
      if (match) return match;
    }
    return null;
  }

  profile = await findProfile(admin);
  // Some older deployments have the service-role variable missing. In that
  // case, use the authenticated server client as a safe read fallback so a
  // valid user is not reduced to a blank, unauthorized shell. The service
  // role remains the primary path and is still required for admin writes.
  if (!profile && authUser) {
    profile = await findProfile(supabase);
  }

  if (!profile || profile.active === false) return signedOut;

  const role = normalizeRole(profile.role);
  const modules = effectiveModules(role, profile.modules);
  const userManager = canManageUsers(role, profile?.can_manage_users);
  const profileId = profile.id || id;
  let twoFactorPending = false;
  if (profile.email_2fa_enabled === true) {
    try {
      twoFactorPending = !twoFactorCookieValid((await cookies()).get(TWO_FACTOR_COOKIE)?.value, profileId);
    } catch {
      twoFactorPending = true; // no signing secret: fail closed
    }
  }
  const identity = {
    id: profileId,
    email,
    name: profile.full_name || email,
    role,
    modules,
    canManageUsers: userManager,
    allowEditClientData: userManager || profile?.allow_edit_client_data === true,
    authenticated: true,
  };
  return { identity, twoFactorPending };
}

export async function requireUserManagementAccess() {
  const identity = await resolveAccessIdentity();
  if (!identity) return { identity: null, status: 401 as const };
  if (!identity.canManageUsers) return { identity, status: 403 as const };
  return { identity, status: null };
}

/** Managers assigned Users & Access may view the directory. */
export async function requireUserDirectoryAccess() {
  const identity = await resolveAccessIdentity();
  if (!identity) return { identity: null, status: 401 as const };
  if (!identity.canManageUsers && !identity.modules.includes("Users & Access")) {
    return { identity, status: 403 as const };
  }
  return { identity, status: null };
}

/**
 * Owner/Admin and explicitly authorized managers retain full profile edit
 * rights. Other managers assigned Users & Access may edit existing non-power
 * users through the PATCH route's manager allowlist.
 */
export async function requireUserProfileEditAccess() {
  const identity = await resolveAccessIdentity();
  if (!identity) return { identity: null, status: 401 as const };
  const canEdit =
    identity.canManageUsers ||
    (identity.role === "manager" && identity.modules.includes("Users & Access"));
  if (!canEdit) return { identity, status: 403 as const };
  return { identity, status: null };
}

/** Reading client and worklist data: the same rule as GET /api/clients (Owner/Admin, or any assigned module). */
export async function requireClientDataReadAccess() {
  const identity = await resolveAccessIdentity();
  if (!identity) return { identity: null, status: 401 as const };
  if (!isPowerUser(identity.role) && identity.modules.length === 0) return { identity, status: 403 as const };
  return { identity, status: null };
}

export async function requireClientDataEditAccess() {
  const identity = await resolveAccessIdentity();
  if (!identity) return { identity: null, status: 401 as const };
  if (!identity.allowEditClientData) return { identity, status: 403 as const };
  return { identity, status: null };
}
