import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The Clients page moved to app/clients/page.tsx with the PracticeOps launch pad (app/page.tsx).
const source = readFileSync(new URL("../app/clients/page.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const groupCardStart = source.indexOf("function GroupCard(");
const groupCardEnd = source.indexOf("// ── Client Card ──", groupCardStart);

assert.notEqual(groupCardStart, -1, "GroupCard must exist");
assert.notEqual(groupCardEnd, -1, "GroupCard boundary must exist");

const groupCard = source.slice(groupCardStart, groupCardEnd);
const modalStart = groupCard.indexOf("{popupOpen && (");
const entityMapStart = groupCard.indexOf("clients.map((c) => {", modalStart);
const entityMapEnd = groupCard.indexOf("              })}", entityMapStart);

assert.notEqual(modalStart, -1, "GroupCard popup/modal must exist");
assert.notEqual(entityMapStart, -1, "GroupCard modal must render entity tiles");
assert.notEqual(entityMapEnd, -1, "GroupCard modal entity-tile boundary must exist");

// Keep this contract scoped to GroupCard's popup entity tile, not ClientCard.
const modalEntityTile = groupCard.slice(entityMapStart, entityMapEnd);

// PracticeOps renders the type badge through the shared TypeTag component.
assert.match(modalEntityTile, /<TypeTag\s+type=\{c\.type\}\s*\/>/, "each GroupCard modal entity tile must retain its BIZ/PERS type badge");
const typeTagStart = source.indexOf("function TypeTag(");
assert.notEqual(typeTagStart, -1, "TypeTag must exist");
assert.match(
  source.slice(typeTagStart, source.indexOf("\n}", typeTagStart)),
  /\{type\s*===\s*"Business"\s*\?\s*"BIZ"\s*:\s*"PERS"\}/,
  "TypeTag must show BIZ for businesses and PERS otherwise",
);
assert.match(
  modalEntityTile,
  /\{\s*c\.active\s*===\s*false\s*&&\s*\(?\s*<span\b[\s\S]*?>\s*INACTIVE\s*<\/span>\s*\)?\s*\}/,
  "the GroupCard modal INACTIVE badge must be structurally controlled by c.active === false",
);

console.log("GroupCard inactive indicator regression check passed");
