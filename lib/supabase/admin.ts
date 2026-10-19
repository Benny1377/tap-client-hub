import { createClient } from "@supabase/supabase-js";

/**
 * Supabase client with service_role key — bypasses RLS.
 * Use only in API routes, after the route has checked who is calling.
 *
 * There is deliberately no fallback to the anon key: a deployment missing the
 * service-role key fails loudly instead of quietly running privileged code
 * paths with public credentials.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  return createClient(url, key, { db: { schema: "tap_hub_project" } });
}

/**
 * Dedicated ticket-database client. Ticket storage intentionally lives in a
 * separate Supabase project from the primary TAP Hub database.
 */
export function createTicketsAdminClient() {
  const url = process.env.TICKETS_SUPABASE_URL!;
  const key = process.env.TICKETS_SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, {
    db: { schema: process.env.TICKETS_SUPABASE_SCHEMA || "tap_hub_project" },
  });
}
