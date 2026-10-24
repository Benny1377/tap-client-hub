import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../components/client-slideover.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../app/api/clients/route.ts", import.meta.url), "utf8");

assert.match(source, /Company name/);
assert.match(source, /value=\{eName\} onChange=\{e => setEName\(e\.target\.value\)\}/);
assert.match(source, /name: eName/);
assert.match(api, /if \(name !== undefined\) clientUpdates\.name = name/);
console.log("Company name editor is wired to the existing client-name update API.");
