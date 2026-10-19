import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const route = read("app/api/send-email/route.ts");
const supportPage = read("app/support/page.tsx");

// Since 04c3363 support email goes to the shared inbox, not personal addresses.
assert.match(route, /const SUPPORT_RECIPIENTS = \["support@aifusioniqlabs\.com"\];/);
assert.doesNotMatch(route, /@gmail\.com/, "no personal addresses in the support route");
assert.match(route, /from:\s*RESEND_FROM/);
assert.match(route, /to:\s*SUPPORT_RECIPIENTS/);
assert.doesNotMatch(route, /const\s*\{[^}]*\b(?:to|from)\b[^}]*\}\s*=\s*await req\.json\(\)/);
assert.match(route, /Authorization:\s*`Bearer \$\{resendKey\}`/);
assert.match(route, /function escapeHtml\(value: string\)/);
assert.match(route, /function toHtml\([\s\S]{0,150}escapeHtml\(/);
assert.match(route, /toHtml\(payload\.summary\)/);
assert.match(route, /toHtml\(payload\.whatHappened\)/);
assert.match(route, /reporterName[\s\S]{0,500}summary[\s\S]{0,500}whatHappened/);
assert.match(route, /status:\s*400/);
// Since 8d760e1 the ticket is saved in TAP Hub first; the email is best-effort, so an email
// failure no longer fails the request (no 502): the route reports emailSent instead.
assert.ok(route.indexOf("createTicket(") > 0 && route.indexOf("createTicket(") < route.indexOf('fetch("https://api.resend.com/emails"'), "the ticket is saved before the email is attempted");
assert.match(route, /emailSent \}, \{ status: 201 \}/, "the route returns 201 with emailSent");

assert.match(supportPage, /fetch\(["']\/api\/send-email["'],\s*\{[\s\S]{0,500}method:\s*["']POST["']/);
assert.match(supportPage, /headers:\s*\{\s*["']Content-Type["']:\s*["']application\/json["']/);
assert.match(supportPage, /body:\s*JSON\.stringify\(\{[\s\S]{0,600}reporterName[\s\S]{0,600}summary[\s\S]{0,600}whatHappened/);
assert.doesNotMatch(supportPage, /window\.location\.href\s*=/);
assert.match(supportPage, /sending/);
assert.match(supportPage, /Ticket \{submitted\.ticketNumber\} created/, "the page confirms the saved ticket");
assert.match(supportPage, /submitted\.emailSent \?/, "the page says whether the email notification went out");
assert.match(supportPage, /support@aifusioniqlabs\.com/, "the support page names the shared inbox");
assert.doesNotMatch(supportPage, /@gmail\.com/, "no personal addresses on the support page");

console.log("support Resend delivery regression checks passed");
