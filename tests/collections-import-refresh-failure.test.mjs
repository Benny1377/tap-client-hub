import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const parseRoute = readFileSync(new URL("../app/api/collections/imports/[id]/parse/route.ts", import.meta.url), "utf8");

test("a failed suggestion refresh keeps the existing batch reviewable", () => {
  assert.match(parseRoute, /const failureStatus = refreshingReview \? "needs_review" : "failed"/);
  assert.match(parseRoute, /\.eq\("status", batch\.status\)/, "status update is conditional on the state read at request start");
});

test("retrying an old failed batch with saved rows takes the non-destructive refresh path", () => {
  assert.match(parseRoute, /if \(batch\.status === "failed"\)[\s\S]*select\("id"\)\.eq\("batch_id", id\)\.limit\(1\)/);
  assert.match(parseRoute, /batch\.status === "failed" && failedBatchHasRows/);
  const refreshBranch = parseRoute.indexOf("if (refreshingReview) {");
  const destructiveReplace = parseRoute.indexOf('.from("collection_import_rows").delete()');
  assert.ok(refreshBranch > -1 && destructiveReplace > refreshBranch, "saved review rows are handled before any initial-parse replacement");
});
