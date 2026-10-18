const ALLOWED_TOKENS = new Set(["contact_name", "invoice_number", "balance", "due_date", "days_past_due"]);

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

/** Render data into a template, escaping the entire body template as HTML text. */
export function renderCollectionsTemplate(template: string, values: Record<string, string>, escapeTemplate = false) {
  const tokens = [...template.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]);
  if (tokens.some((token) => !ALLOWED_TOKENS.has(token) || values[token] === undefined)) throw new Error("TEMPLATE_TOKEN_INVALID");
  const safeTemplate = escapeTemplate ? escapeHtml(template) : template;
  return safeTemplate.replace(/\{([^{}]+)\}/g, (_match, key: string) => escapeHtml(values[key]));
}
