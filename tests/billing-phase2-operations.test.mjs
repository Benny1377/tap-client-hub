import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const { generateFromOperations } = loadTs("app/api/billing/[...path]/route.ts");
const clientServiceId = "6ed7d15b-ef16-4e22-a18b-c9b76a083e76";

function fixtureDb({ adapter, candidateDateRule, frequency = "monthly", sourceRows = [], price = { unit_amount: "125.00", price_source: "rate_card" }, existingCandidates = [] }) {
  const writes = [];
  const reads = [];
  const filters = [];
  const rpcConcurrency = { active: 0, maximum: 0 };
  const service = {
    id: clientServiceId, client_id: "7ed7d15b-ef16-4e22-a18b-c9b76a083e76", active: true,
    frequency, financials_month: 12,
    services: { code: "BOOK", name: "Monthly bookkeeping", tracking: adapter === "period_count_threshold" ? "count" : "done" },
  };
  const map = {
    id: "map-1", client_service_id: clientServiceId, adapter,
    predicate: adapter === "period_count_threshold" ? { threshold: 3 } : adapter === "work_period_done" ? { stage: "done" } : {},
    candidate_date_rule: candidateDateRule || "period_end",
    effective_from: "2026-01-01", effective_to: null, enabled: true,
  };
  class Query {
    constructor(table) { this.table = table; this.operation = "read"; this.payload = null; }
    select() { return this; }
    eq() { return this; }
    in(column, values) { filters.push({ method: "in", table: this.table, column, values }); return this; }
    gte(column, value) { filters.push({ method: "gte", table: this.table, column, value }); return this; }
    lte(column, value) { filters.push({ method: "lte", table: this.table, column, value }); return this; }
    lt(column, value) { filters.push({ method: "lt", table: this.table, column, value }); return this; }
    or() { return this; }
    order() { return this; }
    upsert(payload) { this.operation = "upsert"; this.payload = payload; writes.push({ table: this.table, payload }); return this; }
    async maybeSingle() {
      return { data: this.operation === "upsert" ? { id: "new-candidate", state: this.payload.state } : null, error: null };
    }
    then(resolve, reject) {
      reads.push(this.table);
      let data = [];
      if (this.table === "client_services") data = [service];
      if (this.table === "billing_completion_source_maps") data = [map];
      if (this.table === "work_periods" || this.table === "period_counts") data = sourceRows.map((row) => ({ ...row, client_service_id: row.client_service_id || clientServiceId }));
      if (this.table === "billing_candidates") data = existingCandidates;
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    }
  }
  return {
    writes,
    reads,
    filters,
    rpcConcurrency,
    db: {
      from(table) { return new Query(table); },
      async rpc(name) {
        assert.equal(name, "resolve_billing_price");
        rpcConcurrency.active++;
        rpcConcurrency.maximum = Math.max(rpcConcurrency.maximum, rpcConcurrency.active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        rpcConcurrency.active--;
        return { data: price, error: null };
      },
    },
  };
}

test("recurring generator uses a projected period-end date and Billing-owned candidate write", async () => {
  const { db, writes, reads } = fixtureDb({ adapter: "schedule" });
  const response = await generateFromOperations(db, "actor-1", {
    from: "2026-11-01", to: "2026-11-30", clientServiceIds: [clientServiceId],
  });
  assert.deepEqual(response.result, {
    created: 1, unpriced: 0, existing: 0, skipped: 0,
    skippedByReason: { no_map: 0, map_disabled: 0, source_incomplete: 0, outside_window: 0 },
    candidateIds: ["new-candidate"],
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].table, "billing_candidates");
  assert.equal(writes[0].payload.period, "2026-11");
  assert.equal(writes[0].payload.candidate_date, "2026-11-30");
  assert.equal(writes[0].payload.source_identity, `${clientServiceId}:2026-11`);
  assert.deepEqual(reads.filter((table) => ["client_services", "services", "work_periods", "period_counts"].includes(table)), ["client_services"]);
});

test("quarterly schedule remains anchored to Jan/Apr/Jul/Oct month ends", async () => {
  const { db, writes } = fixtureDb({ adapter: "schedule", frequency: "Quarterly" });
  const response = await generateFromOperations(db, "actor-1", {
    from: "2026-01-01", to: "2026-03-31", clientServiceIds: [clientServiceId],
  });
  assert.equal(response.result.created, 1);
  assert.equal(writes[0].payload.candidate_date, "2026-01-31");
  assert.equal(writes[0].payload.period, "2026-01");
});

test("candidate price resolution is parallel but bounded for summary-sized schedules", async () => {
  const { db, rpcConcurrency } = fixtureDb({ adapter: "schedule" });
  const response = await generateFromOperations(db, "", {
    from: "2026-01-01", to: "2026-12-31", clientServiceIds: [clientServiceId], preview: true,
  });
  assert.equal(response.result.items.length, 12);
  assert.equal(rpcConcurrency.maximum, 8);
});

test("date-only summary projection avoids candidate price RPCs", async () => {
  const { db, rpcConcurrency } = fixtureDb({ adapter: "schedule" });
  const response = await generateFromOperations(db, "", {
    from: "2026-01-01", to: "2026-12-31", clientServiceIds: [clientServiceId], preview: true, dateOnly: true,
  });
  assert.deepEqual(response.result.items[0], { candidateDate: "2026-01-31" });
  assert.equal(response.result.items.length, 12);
  assert.equal(rpcConcurrency.maximum, 0);
});

test("Bi-Weekly recurring services are not assigned guessed dates without an anchor", async () => {
  const { db, writes } = fixtureDb({ adapter: "schedule", frequency: "Bi-Weekly" });
  const response = await generateFromOperations(db, "actor-1", {
    from: "2026-01-01", to: "2026-02-28", clientServiceIds: [clientServiceId],
  });
  assert.equal(response.result.created, 0);
  assert.equal(response.result.skippedByReason.source_incomplete, 1);
  assert.deepEqual(writes, []);
});

test("work-period adapter normalizes verified text YYYYMM periods without Operations writes", async () => {
  const { db, writes } = fixtureDb({
    adapter: "work_period_done", sourceRows: [{ period: "202611", stage: "done", done_at: "2026-12-01T01:30:00Z" }],
  });
  const response = await generateFromOperations(db, "actor-1", {
    from: "2026-11-01", to: "2026-11-30", clientServiceIds: [clientServiceId],
  });
  assert.equal(response.result.created, 1);
  assert.equal(writes[0].payload.period, "2026-11");
  assert.equal(writes[0].payload.candidate_date, "2026-11-30");
  assert.ok(writes.every((write) => write.table === "billing_candidates"));
});

test("work-period adapter accepts text YYYY-MM periods and reports unreadable periods", async () => {
  const { db, writes } = fixtureDb({
    adapter: "work_period_done", sourceRows: [
      { period: "2026-11", stage: "done", done_at: null },
      { period: "202613", stage: "done", done_at: null },
    ],
  });
  const response = await generateFromOperations(db, "actor-1", {
    from: "2026-11-01", to: "2026-11-30", clientServiceIds: [clientServiceId],
  });
  assert.equal(response.result.created, 1);
  assert.equal(response.result.skippedByReason.source_incomplete, 1);
  assert.equal(writes[0].payload.period, "2026-11");
});

test("count adapter accepts numeric YYYYMM periods", async () => {
  const { db, writes } = fixtureDb({
    adapter: "period_count_threshold", sourceRows: [{ period: 202611, processed: 3 }],
  });
  const response = await generateFromOperations(db, "actor-1", {
    from: "2026-11-01", to: "2026-11-30", clientServiceIds: [clientServiceId],
  });
  assert.equal(response.result.created, 1);
  assert.equal(writes[0].payload.period, "2026-11");
});

test("completion-date adapter finds work completed in the window even when its service period is earlier", async () => {
  const { db, writes } = fixtureDb({
    adapter: "work_period_done", candidateDateRule: "completion_date",
    sourceRows: [{ period: "202611", stage: "done", done_at: "2026-12-01T06:30:00Z" }],
  });
  const response = await generateFromOperations(db, "actor-1", {
    from: "2026-12-01", to: "2026-12-31", clientServiceIds: [clientServiceId],
  });
  assert.equal(response.result.created, 1);
  assert.equal(writes[0].payload.period, "2026-11");
  assert.equal(writes[0].payload.candidate_date, "2026-12-01");
  assert.ok(writes.every((write) => write.table === "billing_candidates"));
});

test("completion-date filtering uses Houston midnight offsets across spring DST", async () => {
  const { db, writes } = fixtureDb({
    adapter: "work_period_done", candidateDateRule: "completion_date",
    sourceRows: [{ period: "202602", stage: "done", done_at: "2026-03-09T04:30:00Z" }],
  });
  const response = await generateFromOperations(db, "actor-1", {
    from: "2026-03-08", to: "2026-03-08", clientServiceIds: [clientServiceId],
  });
  assert.equal(response.result.created, 1);
  assert.equal(writes[0].payload.candidate_date, "2026-03-08");
  assert.equal(writes[0].payload.period, "2026-02");
});

test("count-threshold adapter uses processed count and counts unpriced source events", async () => {
  const { db, writes } = fixtureDb({
    adapter: "period_count_threshold", sourceRows: [{ period: "202611", processed: 3 }], price: null,
  });
  const response = await generateFromOperations(db, "actor-1", {
    from: "2026-11-01", to: "2026-11-30", clientServiceIds: [clientServiceId],
  });
  assert.equal(response.result.created, 1);
  assert.equal(response.result.unpriced, 1);
  assert.equal(writes[0].payload.state, "unpriced");
  assert.equal(writes[0].payload.unit, "count");
});

test("schedule preview is read-only and omits already-persisted identities", async () => {
  const identity = `${clientServiceId}:2026-11`;
  const { db, writes } = fixtureDb({
    adapter: "schedule", existingCandidates: [{ client_service_id: clientServiceId, source_identity: identity }],
  });
  const response = await generateFromOperations(db, "", {
    from: "2026-11-01", to: "2026-11-30", clientServiceIds: [clientServiceId], preview: true,
  });
  assert.deepEqual(response.result, { projection: "projected", items: [] });
  assert.equal(writes.length, 0);
});

test("schedule projection includes configured completion sources and stays read-only", async () => {
  for (const [adapter, sourceRows, sourceTable] of [
    ["work_period_done", [{ period: "202611", stage: "done", done_at: null }], "work_periods"],
    ["period_count_threshold", [{ period: "202611", processed: 3 }], "period_counts"],
  ]) {
    const { db, writes, reads } = fixtureDb({ adapter, sourceRows });
    const response = await generateFromOperations(db, "", {
      from: "2026-11-01", to: "2026-11-30", clientServiceIds: [clientServiceId], preview: true,
    });
    assert.equal(response.result.projection, "projected");
    assert.equal(response.result.items.length, 1);
    assert.equal(response.result.items[0].source.adapter, adapter);
    assert.ok(reads.includes(sourceTable));
    assert.deepEqual(writes, []);
  }
});
