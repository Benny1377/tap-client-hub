/**
 * Comment authors are set on the server. Comment lists are re-sent in full on
 * every save, and some saves delete and re-insert them, so a comment that
 * already existed keeps its stored author and only a new comment is credited
 * to the signed-in user. The author name the browser sends is never trusted.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type IncomingComment = { month?: number | null; text?: string; body?: string; createdAt?: string | null };
type StoredComment = { entity_id: string; month: number | null; body: string; created_at: string | null; author_label: string | null };

function instant(value: string | null | undefined): string {
  if (!value) return "";
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? String(ms) : "";
}

function key(entityId: string, month: number | null | undefined, body: string, createdAt: string | null | undefined): string {
  return `${entityId}|${month ?? ""}|${body}|${instant(createdAt)}`;
}

/** Authors of the comments about to be replaced, keyed by entity, month, text and time. */
export async function storedCommentAuthors(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the routes pass schema-specific clients
  supabase: SupabaseClient<any, any, any>,
  entityType: string,
  entityIds: string[],
): Promise<Map<string, string>> {
  const authors = new Map<string, string>();
  if (entityIds.length === 0) return authors;
  const { data, error } = await supabase.from("comments")
    .select("entity_id, month, body, created_at, author_label")
    .eq("entity_type", entityType).in("entity_id", entityIds);
  if (error) throw new Error(`Comment author lookup error: ${error.message}`);
  for (const row of (data || []) as StoredComment[]) {
    authors.set(key(row.entity_id, row.month, row.body, row.created_at), row.author_label || "");
  }
  return authors;
}

/** The author to store for a re-inserted comment: its stored author if it existed, otherwise the signed-in user. */
export function commentAuthor(stored: Map<string, string>, entityId: string, comment: IncomingComment, signedInName: string): string {
  const existing = stored.get(key(entityId, comment.month, comment.text || comment.body || "", comment.createdAt));
  return existing !== undefined ? existing : signedInName;
}

/** True when this comment is already stored (same entity, month and text, and the same time or author). */
export function alreadyStored(rows: Array<{ created_at: string | null; author_label: string | null }>, comment: IncomingComment & { author?: string }): boolean {
  const at = instant(comment.createdAt);
  return rows.some((row) => (at !== "" && instant(row.created_at) === at) || (row.author_label || "") === (comment.author || ""));
}
