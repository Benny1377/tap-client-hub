import { cookies } from "next/headers";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageUsers, effectiveModules, normalizeRole } from "@/lib/access-policy";
import { verifyDemoSession } from "@/lib/demo-session";

type Profile = { id: string; full_name?: string | null; email?: string | null; role?: string | null; modules?: unknown; location?: string | null; can_manage_users?: boolean | null; allow_edit_client_data?: boolean | null };

function normalizedName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function nameMatches(profileName: string, requestedName: string) {
  const profile = normalizedName(profileName);
  const requested = normalizedName(requestedName);
  if (profile === requested) return true;
  if (profile.includes(",")) {
    const [last, first] = profile.split(",").map(part => part.trim());
    return `${first} ${last}` === requested;
  }
  return false;
}

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

export async function resolveAccessIdentity(): Promise<AccessIdentity | null> {
  const cookieStore = await cookies();
  const demoSession = verifyDemoSession(cookieStore.get("tap_demo_session")?.value);
  const demoEmail = demoSession?.email || "";
  let demoName = demoSession?.name || "";
  // Fallback: staff users who lack a tap_demo_session may only have tap_demo_user
  const demoUserFromCookie = cookieStore.get("tap_demo_user")?.value || "";
  if (!demoName && demoUserFromCookie) demoName = decodeURIComponent(demoUserFromCookie);
  let authUser: { id: string; email?: string } | null = null;
  const supabase = await createServerClient();

  try {
    const { data } = await supabase.auth.getUser();
    authUser = data.user ? { id: data.user.id, email: data.user.email } : null;
  } catch {
    // Demo accounts are intentionally supported without a Supabase session.
  }

  if (!authUser && !demoEmail && !demoName) return null;

  const id = authUser?.id || "";
  const email = (authUser?.email || demoEmail).toLowerCase();
  const admin = createAdminClient();
  let profile: Profile | null = null;

  const profileColumns = "id, full_name, email, role, modules, location, can_manage_users, allow_edit_client_data";
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
    if (demoName) {
      const { data: profiles } = await client.from("profiles").select(profileColumns);
      const match = (profiles || []).find((candidate: Profile) => nameMatches(candidate.full_name || "", demoName));
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

  // Preserve the explicit demo accounts without granting any fallback to unknown users.
  const demoFallbacks: Record<string, { role: string; modules: string[] }> = {
    "mmatronin@gmail.com": { role: "admin", modules: ["All"] },
    "ben@aifusioniqlabs.com": { role: "admin", modules: ["All"] },
    "staff@tapallc.com": { role: "staff", modules: ["Clients"] },
  };
  const demoFallback = !profile ? demoFallbacks[demoEmail] : undefined;
  if (!profile && !demoFallback) return null;

  // Auth/profile migrations can leave an otherwise valid legacy demo account
  // with the database defaults (`staff` + no modules). Preserve the explicit
  // trusted-account access contract in that case, while keeping non-empty
  // profile permissions authoritative for every other account.
  const profileModules = effectiveModules(profile?.role, profile?.modules);
  const useDemoAccess = Boolean(
    demoFallback &&
    (!profile || (!profile?.role && profileModules.length === 0) || profileModules.length === 0),
  );
  const role = useDemoAccess ? normalizeRole(demoFallback!.role) : normalizeRole(profile?.role);
  const modules = effectiveModules(role, useDemoAccess ? demoFallback!.modules : profile?.modules);
  const userManager = canManageUsers(role, profile?.can_manage_users);
  return {
    id: profile?.id || id || `demo-${role}`,
    email,
    name: profile?.full_name || demoName || email,
    role,
    modules,
    canManageUsers: userManager,
    allowEditClientData: userManager || profile?.allow_edit_client_data === true,
    authenticated: true,
  };
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

export async function requireClientDataEditAccess() {
  const identity = await resolveAccessIdentity();
  if (!identity) return { identity: null, status: 401 as const };
  if (!identity.allowEditClientData) return { identity, status: 403 as const };
  return { identity, status: null };
}
