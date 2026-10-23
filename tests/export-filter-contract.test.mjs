import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const clientsPage = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const worklist = readFileSync(new URL("../components/worklist-table.tsx", import.meta.url), "utf8");
const exporter = readFileSync(new URL("../lib/export-csv.ts", import.meta.url), "utf8");

assert.match(clientsPage, /exportClientCsv\(filteredClients/);
assert.match(clientsPage, /\[filteredClients\]\);/);
assert.match(clientsPage, /Export \{filteredClients\.length\} filtered/);
assert.match(worklist, /exportClientCsv\(filteredClients,\s*\{\s*serviceKey/);
assert.match(worklist, /monthStatuses: serviceKey === "financials"/);
assert.match(worklist, /worklistState\[`\$\{client\.id\}:\$\{serviceKey\}`\] \?\? \[\]/);
assert.match(exporter, /financialsExportHeaders\(\)/);
assert.match(exporter, /financialsExportValues\(/);
assert.match(worklist, /Export \{filteredClients\.length\} filtered/);
assert.match(exporter, /serviceKey \? \(SERVICE_LABELS\[serviceKey\] \|\| serviceKey\)/);
assert.match(exporter, /anchor\.download = .*clients\.length/);

const oldMasterExport = clientsPage.slice(clientsPage.indexOf("// ── CSV Export ──"), clientsPage.indexOf("// ── Handlers ──"));
assert.doesNotMatch(oldMasterExport, /clients\.map\(/);

console.log("filtered export contract checks passed");
