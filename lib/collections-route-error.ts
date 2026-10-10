type DatabaseError = { message: string; code?: string };

const KNOWN_PREFIX = /^(invalid_input|not_found|conflict|invariant_violation):\s*/i;

/** Keep database diagnostics out of API responses while preserving known domain errors. */
export function collectionsError(
  error: DatabaseError,
  fallbackCode: string,
  fallbackMessage: string,
) {
  const match = error.message.match(KNOWN_PREFIX);
  if (!match) {
    return { error: fallbackMessage, code: fallbackCode, status: 500 };
  }
  const kind = match[1].toLowerCase();
  const detail = error.message.slice(match[0].length).trim();
  const status = kind === "invalid_input" ? 422 : kind === "not_found" ? 404 : 409;
  return {
    error: detail || fallbackMessage,
    code: kind === "invalid_input" ? "INVALID_INPUT" : kind === "not_found" ? "NOT_FOUND" : fallbackCode,
    status,
  };
}
