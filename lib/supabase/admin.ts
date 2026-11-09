import { createClient } from "@supabase/supabase-js";
import { requireServiceRoleKey } from "@/lib/supabase/admin-key";

/**
 * Supabase client with service_role key — bypasses RLS.
 * Use only in server routes that require privileged profile/data access.
 * A public anon key is never an acceptable fallback for admin operations.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is required for admin operations");
  const key = requireServiceRoleKey(process.env.SUPABASE_SERVICE_ROLE_KEY);
  return createClient(url, key, { db: { schema: "tap_hub_project" } });
}

/**
 * Dedicated ticket-database client. Ticket storage intentionally lives in a
 * separate Supabase project from the primary TAP Hub database.
 */
export function createTicketsAdminClient() {
  const url = process.env.TICKETS_SUPABASE_URL;
  const key = process.env.TICKETS_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Ticket database service-role configuration is required");
  return createClient(url, key, {
    db: { schema: process.env.TICKETS_SUPABASE_SCHEMA || "tap_hub_project" },
  });
}
