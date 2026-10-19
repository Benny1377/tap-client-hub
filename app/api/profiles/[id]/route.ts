import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { requireUserManagementAccess } from "@/lib/access-server";
import { isPowerUser } from "@/lib/access-policy";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/profiles/[id]
 * Remove a user from Supabase Auth AND the profiles table.
 * Requires the admin client (service_role key).
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const access = await requireUserManagementAccess();
  if (access.status) return NextResponse.json({ error: access.status === 401 ? "Unauthorized" : "Forbidden" }, { status: access.status });
  try {
    const { id } = await params;

    const supabase = createAdminClient();

    // Profiles imported from the legacy identity source do not always use the
    // Supabase Auth UUID as their profile id. Resolve the auth user by the
    // profile email before deleting, just as the PATCH handler does.
    const { data: profileData } = await supabase
      .from("profiles")
      .select("id, email, role")
      .eq("id", id)
      .maybeSingle();
    const profile = profileData as { id: string; email?: string | null; role?: string | null } | null;
    if (!profile) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (!isPowerUser(access.identity!.role) && isPowerUser(profile.role)) {
      return NextResponse.json({ error: "Only an Owner or Admin can create, change or remove Owner/Admin accounts." }, { status: 403 });
    }

    let authUserId = id;
    if (profile.email) {
      const { data: authUsers, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (listError) {
        return NextResponse.json({ error: listError.message }, { status: 500 });
      }
      const authUserList = (authUsers as unknown as { users: Array<{ id: string; email?: string | null }> }).users || [];
      const authUser = authUserList.find((user) => user.email?.toLowerCase() === profile.email!.toLowerCase());
      if (authUser) authUserId = authUser.id;
    }

    // 1. Delete the auth user when one exists. Imported profile rows may not
    // have a corresponding Auth account, but should still be removable.
    const { error: authError } = await supabase.auth.admin.deleteUser(authUserId);
    if (authError && !authError.message.toLowerCase().includes("user not found")) {
      return NextResponse.json({ error: authError.message }, { status: 500 });
    }

    // 2. Delete the profile row (triggers cascade or manual)
    const { error: profileError } = await supabase
      .from("profiles")
      .delete()
      .eq("id", id);

    if (profileError) {
      return NextResponse.json(
        { error: profileError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}
