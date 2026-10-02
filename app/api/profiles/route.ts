import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { requireUserDirectoryAccess, requireUserManagementAccess, requireUserProfileEditAccess } from "@/lib/access-server";
import { effectiveModules, sanitizeModulesForRole, sanitizeManagerModules, isPowerUser, normalizeRole } from "@/lib/access-policy";
import { usernameFromFullName } from "@/lib/profile-identity";

export const dynamic = "force-dynamic";

/**
 * GET /api/profiles
 * List all profiles mapped to the User shape used by app/users
 */
export async function GET() {
  const access = await requireUserDirectoryAccess();
  if (access.status) return NextResponse.json({ error: access.status === 401 ? "Unauthorized" : "Forbidden" }, { status: access.status });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "User directory is not configured" }, { status: 503 });
  }
  // Read the full directory with the admin client after the explicit server-side
  // access check. The cookie-less anon client silently returns zero rows under RLS.
  const adminSupabase = createAdminClient();
  const { data: profiles, error } = await adminSupabase
    .from("profiles")
    .select("*")
    .order("full_name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!profiles) {
    return NextResponse.json([]);
  }

  // Try to get real emails from auth.users; values stay server-side only.
  let emailMap: Record<string, string> = {};
  try {
    const { data: authUsers, error: authError } = await adminSupabase.auth.admin.listUsers();
    if (!authError && authUsers?.users) {
      for (const u of authUsers.users) {
      emailMap[u.id] = u.email || "";
      }
    }
  } catch {
    // Fallback: derive email from name (no service_role key available)
  }

  // ── DB → User mapping ──
  const ROLE_MAP: Record<string, string> = {
    admin: "Owner / Admin",
    manager: "Manager",
    staff: "Staff",
    offshore: "Offshore",
  };

  const STATUS_MAP: Record<string, string> = {
    invited: "Invite sent",
    active: "Active",
    disabled: "Inactive",
  };

  // Build profile name lookup for reporting_manager UUID → name resolution
  const nameMap: Record<string, string> = {};
  for (const p of profiles) {
    nameMap[p.id] = p.full_name || "";
  }

  const users = profiles.map((p: any) => {
    // ── Normalize name: DB stores "Last,First" but UI should show "First Last" ──
    const rawName = p.full_name || "";
    const displayName = rawName.includes(",")
      ? rawName.split(",").map((s: string) => s.trim()).reverse().join(" ")
      : rawName;

    // Profile email is the approved destination for 2FA. Auth email is intentionally internal.
    const email = p.email || emailMap[p.id] || "";

    // Resolve reporting_manager UUID to display name (also normalize)
    const mgrRaw = p.reporting_manager
      ? (nameMap[p.reporting_manager] || p.reporting_manager)
      : "—";
    const mgrName = typeof mgrRaw === "string" && mgrRaw.includes(",")
      ? mgrRaw.split(",").map((s: string) => s.trim()).reverse().join(" ")
      : mgrRaw;

    return {
      id: p.id,
      name: p.full_name || "",           // DB value for PATCH lookups
      displayName,                        // "First Last" for display
      email,
      username: usernameFromFullName(p.full_name),
      role: ROLE_MAP[p.role] || p.role || "Staff",
      location: p.location || "",
      mgr: mgrName,
      mgrRaw: nameMap[p.reporting_manager] || null,
      modules: effectiveModules(p.role, p.modules),
      status: p.active === false ? "Inactive" : (STATUS_MAP[p.invite_status] || "Active"),
      active: p.active !== false,
      email_2fa_enabled: p.email_2fa_enabled ?? false,
      allow_edit_client_data: p.allow_edit_client_data === true,
    };
  });

  return NextResponse.json(users);
}

export async function POST(request: Request) {
  const access = await requireUserManagementAccess();
  if (access.status) return NextResponse.json({ error: access.status === 401 ? "Unauthorized" : "Forbidden" }, { status: access.status });
  try {
    const body = await request.json();
    const { full_name, email, password, role, location, reporting_manager, modules, email_2fa_enabled, allow_edit_client_data } = body;

    if (!full_name || !email || !password) {
      return NextResponse.json(
        { error: "full_name, email, and password are required" },
        { status: 400 }
      );
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      return NextResponse.json({ error: "A valid email address is required" }, { status: 400 });
    }

    // Public sign-up is intentionally disabled in production. Provision users
    // through the service-role Auth Admin API after the server-side capability
    // check above has authorized this request.
    const adminSupabase = createAdminClient();
    const { data: authData, error: authError } = await adminSupabase.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name, role: role || "staff" },
    });

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 409 });
    }

    if (!authData.user) {
      return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
    }

    // 2. Resolve reporting_manager name → UUID if it looks like a name
    let mgrId: string | null = null;
    if (reporting_manager && reporting_manager !== "—") {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(reporting_manager)) {
        mgrId = reporting_manager;
      } else {
        const { data: mgrProfile } = await adminSupabase
          .from("profiles")
          .select("id")
          .eq("full_name", reporting_manager)
          .maybeSingle();
        if (mgrProfile) {
          mgrId = mgrProfile.id;
        }
      }
    }

    // 3. Create profile record with the same admin client so RLS cannot turn
    // this authorized write into a silent no-op.
    const { error: profileError } = await adminSupabase.from("profiles").insert({
      id: authData.user.id,
      full_name,
      email: normalizedEmail,
      role: role || "staff",
      location: location || null,
      reporting_manager: mgrId,
      modules: sanitizeModulesForRole(role || "staff", modules),
      active: true,
      invite_status: "active",
      email_2fa_enabled: email_2fa_enabled === true,
      allow_edit_client_data: allow_edit_client_data === true,
    });

    if (profileError) {
      // Keep Auth and profiles consistent if profile provisioning fails.
      await adminSupabase.auth.admin.deleteUser(authData.user.id);
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, userId: authData.user.id }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}

// ── Also add PATCH for updating profiles ──

export async function PATCH(request: Request) {
  const access = await requireUserProfileEditAccess();
  if (access.status) return NextResponse.json({ error: access.status === 401 ? "Unauthorized" : "Forbidden" }, { status: access.status });
  const isManagerEdit = !access.identity!.canManageUsers;
  try {
    const body = await request.json();
    const { id, full_name, email, role, location, reporting_manager, modules, allow_edit_client_data, email_2fa_enabled, active } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { db: { schema: "tap_hub_project" } }
    );

    const adminSupabase = createAdminClient();

    // ── Manager edit: explicit, safe allowlist ──
    // Managers may update ordinary profile fields (name, location, reporting
    // manager) and assigned modules for existing non-power users. They can
    // never change role, promote to Owner/Admin, alter active/invite status,
    // change password/email/2FA, or grant the privileged "Users & Access"
    // module. Only the allowlisted fields below are written; everything else
    // is ignored regardless of what the client sends.
    if (isManagerEdit) {
      const { data: targetData } = await adminSupabase
        .from("profiles")
        .select("role, modules")
        .eq("id", id)
        .maybeSingle();
      const target = targetData as { role?: string | null; modules?: unknown } | null;
      if (!target) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }
      const targetRole = normalizeRole(target.role);
      if (isPowerUser(targetRole)) {
        return NextResponse.json({ error: "Managers cannot edit Owner/Admin accounts" }, { status: 403 });
      }

      const updateData: { full_name?: string; location?: string | null; reporting_manager?: string | null; modules?: string[] } = {};
      if (full_name !== undefined) updateData.full_name = full_name;
      if (location !== undefined) updateData.location = location;

      if (reporting_manager !== undefined) {
        if (!reporting_manager || reporting_manager === "—") {
          updateData.reporting_manager = null;
        } else {
          const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          if (uuidRegex.test(reporting_manager)) {
            updateData.reporting_manager = reporting_manager;
          } else {
            const { data: mgrProfile } = await supabase
              .from("profiles")
              .select("id")
              .eq("full_name", reporting_manager)
              .maybeSingle();
            updateData.reporting_manager = mgrProfile ? mgrProfile.id : null;
          }
        }
      }

      if (modules !== undefined) {
        updateData.modules = sanitizeManagerModules(targetRole, target.modules, modules);
      }

      // Use the service-role client for writes. The anon client has no request
      // auth session here, so RLS can silently update zero rows without an error.
      const { data: updatedProfile, error } = await adminSupabase
        .from("profiles")
        .update(updateData)
        .eq("id", id)
        .select("id")
        .maybeSingle();
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      if (!updatedProfile) {
        return NextResponse.json({ error: "User profile was not updated" }, { status: 404 });
      }
      return NextResponse.json({ success: true });
    }

    // ── Owner/Admin full edit (unchanged) ──
    const { data: targetProfileData } = await adminSupabase.from("profiles").select("email").eq("id", id).maybeSingle();
    const targetEmail = (targetProfileData as unknown as { email?: string } | null)?.email?.toLowerCase();
    const { data: authUsers } = await adminSupabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const authUsersList = (authUsers as unknown as { users: Array<{ id: string; email?: string | null }> } | null)?.users || [];
    const authUserId = authUsersList.find((user) => user.email?.toLowerCase() === targetEmail)?.id || id;
    const updateData: any = {};
    if (full_name !== undefined) updateData.full_name = full_name;
    if (email !== undefined) {
      const normalizedEmail = String(email).trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
        return NextResponse.json({ error: "A valid email address is required" }, { status: 400 });
      }
      // Keep the authentication and 2FA destination addresses in sync for staff users.
      const { error: emailError } = await adminSupabase.auth.admin.updateUserById(authUserId, { email: normalizedEmail });
      if (emailError) return NextResponse.json({ error: emailError.message }, { status: 400 });
      updateData.email = normalizedEmail;
    }
    if (email_2fa_enabled !== undefined) updateData.email_2fa_enabled = email_2fa_enabled === true;
    if (role !== undefined) updateData.role = role;
    if (location !== undefined) updateData.location = location;
    if (modules !== undefined) {
      let moduleRole = role;
      if (moduleRole === undefined) {
        const adminSupabase = createAdminClient();
        const { data: existing } = await adminSupabase
          .from("profiles")
          .select("role")
          .eq("id", id)
          .maybeSingle();
        moduleRole = existing?.role || "staff";
      }
      updateData.modules = sanitizeModulesForRole(moduleRole, modules);
    }
    if (active !== undefined) {
      updateData.active = active === true;
      // The Users & Access checkbox represents the effective account status.
      // Keep the legacy invite_status field synchronized unless an explicit
      // invite status was supplied by an administrative caller.
      if (body.invite_status === undefined) {
        updateData.invite_status = active === true ? "active" : "disabled";
      }
    }
    if (body.invite_status !== undefined) updateData.invite_status = body.invite_status;
    if (allow_edit_client_data !== undefined) updateData.allow_edit_client_data = allow_edit_client_data === true;

    // Resolve reporting_manager name → UUID if needed
    if (reporting_manager !== undefined) {
      if (!reporting_manager || reporting_manager === "—") {
        updateData.reporting_manager = null;
      } else {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (uuidRegex.test(reporting_manager)) {
          updateData.reporting_manager = reporting_manager;
        } else {
          // It's a name — look up UUID
          const { data: mgrProfile } = await supabase
            .from("profiles")
            .select("id")
            .eq("full_name", reporting_manager)
            .maybeSingle();
          updateData.reporting_manager = mgrProfile ? mgrProfile.id : null;
        }
      }
    }

    // Handle password change if provided (uses admin client to update auth user)
    if (body.password) {
      try {
        const { error: pwError } = await adminSupabase.auth.admin.updateUserById(authUserId, { password: body.password });
        if (pwError) {
          return NextResponse.json({ error: pwError.message }, { status: 400 });
        }
      } catch (pwErr: any) {
        return NextResponse.json({ error: pwErr.message || "Failed to update password" }, { status: 400 });
      }
    }

    // Use the service-role client for the profile write. The anon client does
    // not carry the browser session in this route and RLS can otherwise make
    // the update a silent no-op.
    const { data: updatedProfile, error } = await adminSupabase
      .from("profiles")
      .update(updateData)
      .eq("id", id)
      .select("id, active")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!updatedProfile) {
      return NextResponse.json({ error: "User profile was not updated" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}
