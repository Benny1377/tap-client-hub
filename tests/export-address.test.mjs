import assert from "node:assert/strict";

const { buildClientCsv } = await import(new URL("../lib/export-csv.ts", import.meta.url).href);

const csv = buildClientCsv([{
  id: "client-1",
  cid: "CID-1",
  name: 'Client, "One"',
  type: "Business",
  group: "North",
  city: "Austin",
  state: "TX",
  zip: "78701",
  address: '101 "Main", Suite 4',
  emails: [],
  phones: [],
  services: [],
}], {});

const [header, row] = csv.split("\n");
assert.match(header, /"Address"/);
assert.match(header, /"ZIP"/);
assert.match(row, /"101 ""Main"", Suite 4"/);
assert.match(row, /"78701"/);
assert.match(row, /"Client, ""One"""/);
console.log("export address regression tests passed");
