import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Line endings normalised so the checks behave the same on Windows checkouts.
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
// The Clients page moved to app/clients/page.tsx with the PracticeOps launch pad (app/page.tsx).
const clientsPage = read("../app/clients/page.tsx");
const worklist = read("../components/worklist-table.tsx");
const exporter = read("../lib/export-csv.ts");

assert.match(clientsPage, /exportClientCsv\(filteredClients/);
assert.match(clientsPage, /\[filteredClients\]\);/);
// PracticeOps labels the button "Export to Excel" and keeps the filtered count in its title.
assert.match(clientsPage, /Export \$\{filteredClients\.length\} filtered/);
assert.match(worklist, /exportClientCsv\(filteredClients,\s*\{\s*serviceKey/);
assert.match(worklist, /Export \$\{filteredClients\.length\} filtered/);
assert.match(exporter, /serviceKey \? \(SERVICE_LABELS\[serviceKey\] \|\| serviceKey\)/);
assert.match(exporter, /anchor\.download = .*clients\.length/);

const oldMasterExport = clientsPage.slice(clientsPage.indexOf("// ── CSV Export ──"), clientsPage.indexOf("// ── Handlers ──"));
assert.doesNotMatch(oldMasterExport, /clients\.map\(/);

console.log("filtered export contract checks passed");
