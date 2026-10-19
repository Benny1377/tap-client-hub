import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchesClientSearch } from "../lib/data.ts";

// Line endings normalised so the checks behave the same on Windows checkouts.
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
// The Clients page moved to app/clients/page.tsx with the PracticeOps launch pad (app/page.tsx).
const page = read("../app/clients/page.tsx");
const modal = read("../components/client-modal.tsx");
const slideover = read("../components/client-slideover.tsx");

const client = {
  id: "client-1",
  cid: "TAP-1001",
  name: "Acme Services",
  type: "Business",
  city: "Houston",
  group: "Acme Group",
  contact: "Jane Doe",
  address: "100 Main St",
  emails: ["jane@acme.test"],
  phones: ["(713) 555-1212"],
  services: [],
};

// ISS-008: raw 10-digit phone search must match formatted stored values.
assert.equal(matchesClientSearch(client, "7135551212"), true);
assert.equal(matchesClientSearch(client, "Acme"), true, "ordinary text search must remain available");
assert.equal(matchesClientSearch(client, "9999999999"), false);
assert.match(page, /matchesClientSearch\((?:c|client), search\)/, "Clients page must use the tested search helper");

// ISS-009: client cards display the requested four ZIP characters (PracticeOps: the zip4 helper).
const zip4Start = page.indexOf("function zip4(");
assert.notEqual(zip4Start, -1, "Clients page must keep its ZIP display helper");
assert.match(page.slice(zip4Start, page.indexOf("\n}", zip4Start)), /\.replace\(\/\\\.0\+\$\/, ""\)[\s\S]*\.(?:substring|slice)\(0, 4\)/, "ZIP display must strip .0 and show four characters");
assert.match(page, /\{zip4\((?:c|client)\.zip\)\}/, "client cards must use the ZIP display helper");
for (const route of ["fin", "pr", "stx", "t9", "rend", "annual"]) {
  const source = read(`../app/${route}/page.tsx`);
  assert.match(source, /onClientClick=/, `${route} module must wire client-card opening`);
  assert.match(source, /<ClientSlideover/, `${route} module must render the shared client slideover`);
}

// ISS-011: EIN and Notes belong inside Payroll, not general client details.
const modalClientSection = modal.slice(modal.indexOf('className="fsect" style={fsectStyle}>Client'), modal.indexOf("{/* Payroll */}"));
const modalPayrollSection = modal.slice(modal.indexOf("{/* Payroll */}"), modal.indexOf("{/* Sales Tax */}"));
assert.doesNotMatch(modalClientSection, /General Notes|clientEin|>EIN</, "Add Client general details must not expose EIN or General Notes");
assert.match(modalPayrollSection, />EIN</, "Add Client Payroll card must expose EIN");
assert.match(modalPayrollSection, />Notes</, "Add Client Payroll card must expose Notes");
assert.match(modal, /ein:\s*clientEin\.trim\(\)/, "Add Client must persist Payroll EIN to the legacy client EIN field");
assert.match(modal, /reportingNotes:\s*prReportingNotes/, "Add Client must persist Payroll Notes on the payroll service");

const universalDetails = slideover.slice(slideover.lastIndexOf("{/* Group */}"), slideover.lastIndexOf("{/* ── Services ── */}"));
// General Notes was deliberately added back to the general details (9625c95, after ISS-011);
// EIN stays in Payroll and no dead UI may remain.
assert.doesNotMatch(universalDetails, /\{false &&|>EIN</, "general Clients details must not contain dead UI or EIN");
assert.match(universalDetails, /General Notes/, "general Clients details keep the General Notes field");

const universalPayroll = slideover.slice(slideover.indexOf("{/* Payroll: credentials section */}"), slideover.indexOf("{/* Sales Tax line items */}"));
assert.match(universalPayroll, />EIN</, "universal Payroll card must expose EIN");
assert.match(universalPayroll, />Notes</, "universal Payroll card must label payroll notes as Notes");
assert.doesNotMatch(universalPayroll, /Reporting Notes/, "old Reporting Notes label must be removed");

const modulePayroll = slideover.slice(slideover.indexOf('{moduleKey === "payroll"'), slideover.indexOf("{/* Tax return details */}"));
assert.match(modulePayroll, />EIN</, "Payroll module slideover must expose EIN");
assert.match(modulePayroll, />Notes</, "Payroll module slideover must label payroll notes as Notes");
assert.doesNotMatch(modulePayroll, /Reporting Notes/, "old Reporting Notes label must be removed from Payroll module");
assert.match(slideover, /ein:\s*eEinRef\.current\?\.value \?\? eEin/, "autosave must preserve legacy EIN data");

console.log("ISS-008, ISS-009, and ISS-011 regression checks passed");
