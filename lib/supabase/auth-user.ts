/**
 * Resolve the current authenticated user for server-side account APIs, through
 * the shared authoritative access resolver (which also enforces 2FA).
 * Client-writable display cookies are never accepted as authentication.
 */
import { createClient } from "@supabase/supabase-js";
import { resolveAccessIdentity } from "@/lib/access-server";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export function getSupabaseClient() {
  return createClient(URL, ANON_KEY, { db: { schema: "tap_hub_project" } });
}

export function getSupabaseClientDefault() {
  return createClient(URL, ANON_KEY);
}

export async function getAuthUser(_cookieHeader: string, options: { allowPendingTwoFactor?: boolean } = {}) {
  const identity = await resolveAccessIdentity(options);
  if (!identity) return null;

  return {
    user: {
      id: identity.id,
      email: identity.email,
      user_metadata: { full_name: identity.name, role: identity.role },
    } as any,
    supabase: getSupabaseClient(),
  };
}
