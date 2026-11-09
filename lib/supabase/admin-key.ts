export function requireServiceRoleKey(key: string | undefined): string {
  if (!key?.trim()) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for admin operations");
  }
  return key;
}
