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

test("a successful retry explicitly restores failed batch status to needs_review", () => {
  const refreshBranch = parseRoute.slice(parseRoute.indexOf("if (refreshingReview) {"), parseRoute.indexOf("const { error: clearError }"));
  assert.match(refreshBranch, /update\(\{ status: "needs_review", metadata: refreshedMetadata/);
  assert.match(refreshBranch, /\.eq\("status", batch\.status\)\.select\("id"\)\.maybeSingle\(\)/,
    "the update must target the status observed at request start and prove a row was changed");
  assert.match(refreshBranch, /metadataError \|\| !updatedBatch/);
});

test("failed row inserts log only sanitized diagnostics", () => {
  const insertFailure = parseRoute.slice(parseRoute.indexOf('if (rowError || !data)'), parseRoute.indexOf("const firstByText"));
  assert.match(insertFailure, /database_code: rowError\?\.code/);
  assert.match(insertFailure, /row_count: rows\.length/);
  assert.match(insertFailure, /chunk_size: chunk\.length/);
  assert.match(insertFailure, /partial_rows_cleanup_failed: Boolean\(cleanupError\)/);
  assert.doesNotMatch(insertFailure, /rowError\.(message|details|hint)|raw_text|customer_name/);
});

test("initial extraction inserts bounded chunks and removes partial rows on failure", () => {
  assert.match(parseRoute, /const chunkSize = 200/);
  assert.match(parseRoute, /for \(let offset = 0; offset < rows\.length; offset \+= chunkSize\)/);
  assert.match(parseRoute, /\.insert\(chunk\)\.select\("id,page_number,row_number,raw_text"\)/);
  assert.match(parseRoute, /\.from\("collection_import_rows"\)\.delete\(\)\.eq\("batch_id", id\)/);
});
