import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Line endings normalised so the checks behave the same on Windows checkouts.
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const modal = read("../components/client-modal.tsx");
// The Clients page moved to app/clients/page.tsx with the PracticeOps launch pad (app/page.tsx).
const page = read("../app/clients/page.tsx");
const route = read("../app/api/clients/route.ts");

assert.match(modal, /eftps:\s*prEftps\s*\|\|\s*null/, "Add Client must retain Payroll EFTPS in its service payload");
assert.match(modal, /filingType:\s*taxFilingType\s*\|\|\s*null/, "Add Client must retain Tax Return filing type in its service payload");
assert.match(modal, /await onSave\(/, "Add Client must remain open until its save callback resolves");

const saveStart = page.indexOf("const handleModalSave = useCallback(async");
const saveEnd = page.indexOf("  return (", saveStart);
assert.notEqual(saveStart, -1, "Clients page Add Client save handler must exist");
const saveHandler = page.slice(saveStart, saveEnd);
const servicesPut = saveHandler.indexOf("const servicesRes = await fetch");
const addToState = saveHandler.indexOf("addClient(newClient)");
assert.ok(servicesPut >= 0, "Add Client must await the services PUT instead of fire-and-forget it");
assert.ok(addToState > servicesPut, "Add Client must not enter client state before services are saved");
assert.match(
  saveHandler,
  /const servicesRes = await fetch\([\s\S]*?body:\s*JSON\.stringify\(\{ id: newClient\.id, services \}\)[\s\S]*?if \(!servicesRes\.ok\) \{[\s\S]*?throw new Error\(/,
  "Add Client must send the original services payload and surface a non-OK service save",
);

assert.match(route, /const normalizeAssignedTo = \(assignedTo: unknown\): string \| null =>/, "service PUT must normalize UI assignees before database writes");
assert.match(route, /assigned_to:\s*normalizeAssignedTo\(svc\.assignedTo\)/, "new client_services rows must use the normalized assignee");
assert.match(route, /return_type:\s*svc\.filingType\s*\|\|\s*null/, "new Tax Return rows must map filingType to return_type");
assert.match(route, /eftps:\s*svc\.eftps\s*\|\|\s*null/, "new Payroll rows must map eftps to client_services.eftps");

console.log("Add Client service persistence regression checks passed");
