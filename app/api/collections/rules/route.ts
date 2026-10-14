import { NextResponse } from "next/server";
import { requireLedgerReadAccess } from "@/lib/billing-access";
import { requireBillingPowerUser } from "@/lib/billing-access";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const RULE_FIELDS = new Set(["stage", "label", "days_past_due", "automatic", "enabled", "subject_template", "body_template"]);
const SETTING_FIELDS = new Set(["timezone", "send_start", "send_end", "weekdays_only", "minimum_balance", "direct_escalation_threshold"]);

function invalid(message: string) {
  return NextResponse.json({ error: message, code: "INVALID_CONFIGURATION" }, { status: 422, headers: NO_STORE });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function loadRulesResponse() {
  const db = createAdminClient();
  const [{ data: rules, error: rulesError }, { data: settings, error: settingsError }] = await Promise.all([
    db.from("collection_ladder_rules")
      .select("stage, label, days_past_due, automatic, enabled, subject_template, body_template")
      .order("stage", { ascending: true }),
    db.from("collection_settings")
      .select("timezone, minimum_balance, direct_escalation_threshold, send_start, send_end, weekdays_only")
      .eq("id", "default")
      .maybeSingle(),
  ]);
  if (rulesError || settingsError || !settings) return null;
  return {
    rules: rules || [],
    firm_timezone: settings.timezone || "America/Chicago",
    settings: {
      minimum_balance: String(settings.minimum_balance),
      direct_escalation_threshold: String(settings.direct_escalation_threshold),
      send_start: String(settings.send_start).slice(0, 5),
      send_end: String(settings.send_end).slice(0, 5),
      weekdays_only: settings.weekdays_only,
    },
  };
}

export async function GET() {
  const access = await requireLedgerReadAccess();
  if (access.response) return access.response;

  const data = await loadRulesResponse();
  if (!data) {
    return NextResponse.json(
      { error: "Unable to load Collections rules", code: "RULES_READ_FAILED" },
      { status: 500, headers: NO_STORE },
    );
  }
  return NextResponse.json(data, { headers: NO_STORE });
}

export async function PATCH(request: Request) {
  const access = await requireBillingPowerUser();
  if (access.response) return access.response;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400, headers: NO_STORE });
  }
  if (!isObject(body) || Object.keys(body).some((key) => key !== "rules" && key !== "settings")) {
    return invalid("Only rules and settings may be updated");
  }
  const rules = body.rules === undefined ? [] : body.rules;
  const settings = body.settings === undefined ? {} : body.settings;
  if (!Array.isArray(rules) || !isObject(settings)) return invalid("Rules must be an array and settings must be an object");
  const validRules = rules.every((rule) => {
    if (!isObject(rule) || !Number.isInteger(rule.stage) || Number(rule.stage) < 1 || Number(rule.stage) > 5) return false;
    if (Object.keys(rule).some((key) => !RULE_FIELDS.has(key))) return false;
    if (rule.label !== undefined && (typeof rule.label !== "string" || !rule.label.trim() || rule.label.length > 80)) return false;
    if (rule.days_past_due !== undefined && (!Number.isInteger(rule.days_past_due) || Number(rule.days_past_due) < 1 || Number(rule.days_past_due) > 3650)) return false;
    if (rule.automatic !== undefined && typeof rule.automatic !== "boolean") return false;
    if (rule.enabled !== undefined && typeof rule.enabled !== "boolean") return false;
    if (rule.subject_template !== undefined && (typeof rule.subject_template !== "string" || rule.subject_template.length > 240)) return false;
    if (rule.body_template !== undefined && (typeof rule.body_template !== "string" || rule.body_template.length > 8000)) return false;
    return !(Number(rule.stage) >= 4 && rule.automatic === true);
  });
  if (!validRules) return invalid("A rule has invalid values; approval stages 4 and 5 cannot be automated");
  if (Object.keys(settings).some((key) => !SETTING_FIELDS.has(key))) return invalid("A settings field is unsupported; sender and test-recipient setup is deferred to integrations");
  if (settings.timezone !== undefined && (typeof settings.timezone !== "string" || settings.timezone.length > 100)) return invalid("timezone must be a valid IANA timezone name");
  for (const key of ["send_start", "send_end"] as const) {
    if (settings[key] !== undefined && (typeof settings[key] !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(settings[key] as string))) return invalid(`${key} must use HH:MM`);
  }
  for (const key of ["minimum_balance", "direct_escalation_threshold"] as const) {
    if (settings[key] !== undefined && (typeof settings[key] !== "number" || !Number.isFinite(settings[key]) || settings[key] < 0 || settings[key] > 1000000000)) return invalid(`${key} must be a non-negative amount`);
  }
  if (settings.weekdays_only !== undefined && typeof settings.weekdays_only !== "boolean") return invalid("weekdays_only must be a boolean");

  const db = createAdminClient();
  const { error } = await db.rpc("update_collections_configuration", {
    p_actor: access.identity!.id,
    p_rules: rules,
    p_settings: settings,
  });
  if (error) {
    const invalidConfig = error.code === "22023" || error.code === "22P02" || error.code === "23514";
    return NextResponse.json(
      { error: invalidConfig ? "Configuration values are invalid" : "Unable to save Collections rules", code: invalidConfig ? "INVALID_CONFIGURATION" : "RULES_UPDATE_FAILED" },
      { status: invalidConfig ? 422 : 500, headers: NO_STORE },
    );
  }
  const data = await loadRulesResponse();
  if (!data) return NextResponse.json({ error: "Rules were saved but could not be reloaded", code: "READ_AFTER_WRITE_FAILED" }, { status: 500, headers: NO_STORE });
  return NextResponse.json(data, { headers: NO_STORE });
}
