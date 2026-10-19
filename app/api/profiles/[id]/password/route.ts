import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { resolveAccessIdentity } from "@/lib/access-server";
import { isPowerUser } from "@/lib/access-policy";
import { passwordProblem } from "@/lib/password-policy";

/** True when `password` is the current password for `email`. The check's own session is ended at once. */
async function currentPasswordMatches(email: string, password: string): Promise<boolean> {
  const verifier = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await verifier.auth.signInWithPassword({ email, password });
  if (error || !data.session) return false;
  await verifier.auth.signOut({ scope: "local" }).catch(() => {});
  return true;
}

/**
 * POST /api/profiles/[id]/password
 * Change a user's password using the Supabase admin API (bypasses RLS).
 * Body: { password: string, currentPassword?: string }
 *
 * - Your own password: the current password is required, so a borrowed or
 *   stolen session cannot lock the real user out.
 * - Someone else's: needs user-management rights; only an Owner/Admin may reset
 *   an Owner/Admin account.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const identity = await resolveAccessIdentity();
    if (!identity) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!identity.canManageUsers && identity.id !== id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { password, currentPassword } = await request.json();

    const problem = passwordProblem(password);
    if (problem) {
      return NextResponse.json({ error: problem }, { status: 400 });
    }

    const supabase = createAdminClient();

    // `profiles.id` is not guaranteed to be the Supabase Auth user id. TAP Hub
    // has legacy/imported profiles where the two UUIDs differ. Resolve the
    // auth account by the profile's canonical email before updating it.
    let authUserId = id;
    const { data: profile } = await supabase
      .from("profiles")
      .select("email, role")
      .eq("id", id)
      .maybeSingle();

    const ownPassword = identity.id === id;
    if (ownPassword) {
      if (typeof currentPassword !== "string" || !currentPassword || !(await currentPasswordMatches(identity.email, currentPassword))) {
        return NextResponse.json({ error: "Your current password is incorrect." }, { status: 400 });
      }
    } else if (!profile) {
      // Without this, the email fallback below would change the caller's own password.
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    } else if (!isPowerUser(identity.role) && isPowerUser(profile.role)) {
      return NextResponse.json({ error: "Only an Owner or Admin can reset an Owner or Admin password." }, { status: 403 });
    }

    if (profile?.email || identity.email) {
      const canonicalEmail = (profile?.email || identity.email).trim().toLowerCase();
      const { data: authUsers, error: listError } = await supabase.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      if (listError) {
        return NextResponse.json({ error: listError.message }, { status: 500 });
      }
      const authUserList = (authUsers as unknown as { users: Array<{ id: string; email?: string | null }> }).users || [];
      const matchingAuthUser = authUserList.find(
        (authUser) => authUser.email?.trim().toLowerCase() === canonicalEmail
      );
      if (!matchingAuthUser) {
        return NextResponse.json({ error: "No login account found for this profile" }, { status: 404 });
      }
      authUserId = matchingAuthUser.id;
    }

    const { error } = await supabase.auth.admin.updateUserById(authUserId, {
      password,
    });

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    const response = NextResponse.json({ success: true });
    response.cookies.delete("tap_force_password");
    return response;
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}
