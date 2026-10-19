import { createAdminClient } from "@/lib/supabase/admin";
import { usernameFromFullName } from "@/lib/profile-identity";

type Profile = { id: string; full_name: string | null; email: string | null; active: boolean | null };

/**
 * The one active profile whose email or username is what someone typed, or null.
 * Server-only: callers never return the profile's email to the browser, so a
 * username cannot be used to look up someone's address.
 */
export async function findActiveProfileForLogin(identifier: string): Promise<Profile | null> {
  const normalized = identifier.trim().toLowerCase();
  if (!normalized || normalized.length > 254) return null;
  const admin = createAdminClient();
  const { data: profiles, error } = await admin.from("profiles").select("id,full_name,email,active").eq("active", true);
  if (error) throw new Error(`profiles query failed: ${error.message}`);
  const matches = ((profiles ?? []) as Profile[]).filter((profile) =>
    profile.email?.trim().toLowerCase() === normalized || usernameFromFullName(profile.full_name) === normalized,
  );
  return matches.length === 1 && matches[0].email ? matches[0] : null;
}

/** The sign-in email for what someone typed: the matching profile's email, or the text as typed. */
export async function resolveLoginEmail(identifier: string): Promise<string> {
  const profile = await findActiveProfileForLogin(identifier);
  return profile?.email ? profile.email.trim().toLowerCase() : identifier.trim().toLowerCase();
}
