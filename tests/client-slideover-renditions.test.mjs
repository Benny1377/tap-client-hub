import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Line endings normalised: the marker below is matched with "\n", which a Windows checkout writes as "\r\n".
const source = readFileSync(new URL("../components/client-slideover.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const cardStart = source.indexOf("function SingleServiceCard(");
const universalEnd = source.indexOf("// ══════════════════════════════════════════════════════════════\n  // MODULE-SPECIFIC VIEW", cardStart);

assert.notEqual(cardStart, -1, "the reusable universal service card must exist");
assert.notEqual(universalEnd, -1, "the universal card must end before the module-specific view");

const universalCard = source.slice(cardStart, universalEnd);
assert.match(
  universalCard,
  /const isUniversalRenditions = !moduleKey && svc\.key === "renditions";/,
  "universal Renditions must have an explicit body-only branch",
);
assert.match(
  universalCard,
  /\{isUniversalRenditions && \([\s\S]*?Assigned To[\s\S]*?saveServiceField\("renditions", "assignedTo", e\.target\.value\)[\s\S]*?\)\}/,
  "universal Renditions must retain exactly its Assigned To control",
);
assert.match(
  universalCard,
  /\{!isUniversalRenditions && \([\s\S]*?\{isAnnualReports && svc\.enabled && \([\s\S]*?State Renewals[\s\S]*?Enable state renewal tracking[\s\S]*?\{monthCells\(svc\.key\)\}/,
  "Annual Reports must keep its renewal tracking and month timeline outside the Renditions-only body",
);

console.log("universal Renditions card regression check passed");
