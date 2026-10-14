"use client";

import { useState } from "react";
import type { CollectionsRuleUpdate, CollectionsSettingsUpdate } from "@/lib/collections-api";
import type { ApiResult } from "@/lib/billing-ui/api";
import type { CollectionRuleSettings } from "@/lib/billing-ui/types";
import { hintStyle, panelStyle } from "@/components/billing/ui";

const fieldStyle = { display: "grid", gap: 5, fontSize: 12.5, color: "var(--muted)" } as const;
const inputStyle = { border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px", color: "var(--ink)", background: "white", font: "inherit", minWidth: 0 } as const;

export function CollectionsRulesEditor({
  value,
  canEdit,
  onSave,
}: {
  value: CollectionRuleSettings;
  canEdit: boolean;
  onSave: (input: { rules: CollectionsRuleUpdate[]; settings: CollectionsSettingsUpdate }) => Promise<ApiResult<CollectionRuleSettings>>;
}) {
  const [rules, setRules] = useState(value.rules);
  const [timezone, setTimezone] = useState(value.firm_timezone);
  const [settings, setSettings] = useState(value.settings);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  // Re-sync when the server's rules change, without remounting: a remount would
  // collapse the panel and drop the "Rules saved" confirmation after each save.
  const valueKey = JSON.stringify(value);
  const [syncedKey, setSyncedKey] = useState(valueKey);
  if (valueKey !== syncedKey) {
    setSyncedKey(valueKey);
    setRules(value.rules);
    setTimezone(value.firm_timezone);
    setSettings(value.settings);
  }

  if (!canEdit) return null;
  const editRule = (stage: number, changes: Partial<(typeof rules)[number]>) => {
    setRules((current) => current.map((rule) => rule.stage === stage ? { ...rule, ...changes } : rule));
  };
  const editSetting = (key: keyof typeof settings, next: string | boolean) => {
    setSettings((current) => ({ ...current, [key]: next }));
  };
  const submit = async () => {
    setSaving(true);
    setMessage("");
    const result = await onSave({
      rules: rules.map(({ stage, label, days_past_due, automatic, enabled, subject_template, body_template }) => ({
        stage, label, days_past_due, automatic, enabled, subject_template, body_template,
      })),
      settings: {
        timezone,
        minimum_balance: Number(settings.minimum_balance),
        direct_escalation_threshold: Number(settings.direct_escalation_threshold),
        send_start: settings.send_start,
        send_end: settings.send_end,
        weekdays_only: settings.weekdays_only,
      },
    });
    if (result.ok === true) {
      setRules(result.data.rules);
      setTimezone(result.data.firm_timezone);
      setSettings(result.data.settings);
      setMessage("Rules saved. Email delivery remains disabled.");
    } else setMessage(result.message);
    setSaving(false);
  };

  return (
    <details style={{ ...panelStyle, marginTop: 12 }} data-collections-rules-editor>
      <summary style={{ cursor: "pointer", fontWeight: 700 }}>Owner/Admin · Configure Collections rules</summary>
      <p style={hintStyle}>Stage and balance rules affect the preview. Send-window settings are stored for the future integration; nothing is sent or scheduled here. Sender and test-recipient setup belongs to the integrations phase.</p>
      <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
        {rules.map((rule) => (
          <fieldset key={rule.stage} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12, display: "grid", gap: 10 }}>
            <legend style={{ padding: "0 5px", fontWeight: 700 }}>Touch {rule.stage} · {rule.stage >= 4 ? "Owner/Admin gate" : "Reminder"}</legend>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
              <label style={fieldStyle}>Label<input style={inputStyle} maxLength={80} value={rule.label} onChange={(event) => editRule(rule.stage, { label: event.target.value })} /></label>
              <label style={fieldStyle}>Trigger · days past due<input style={inputStyle} type="number" min={1} max={3650} value={rule.days_past_due} onChange={(event) => editRule(rule.stage, { days_past_due: Number(event.target.value) })} /></label>
              <label style={{ ...fieldStyle, alignContent: "center" }}><span>Enabled</span><span><input type="checkbox" checked={rule.enabled} onChange={(event) => editRule(rule.stage, { enabled: event.target.checked })} /> Use this rule</span></label>
              {rule.stage <= 3 ? <label style={{ ...fieldStyle, alignContent: "center" }}><span>Action</span><span><input type="checkbox" checked={rule.automatic} onChange={(event) => editRule(rule.stage, { automatic: event.target.checked })} /> Automatic reminder (delivery still off)</span></label> : <span style={{ ...hintStyle, alignSelf: "center" }}>Always manual; Owner/Admin approval required.</span>}
            </div>
            <label style={fieldStyle}>Subject template<input style={inputStyle} maxLength={240} value={rule.subject_template} onChange={(event) => editRule(rule.stage, { subject_template: event.target.value })} /></label>
            <label style={fieldStyle}>Message template<textarea style={{ ...inputStyle, minHeight: 90, resize: "vertical" }} maxLength={8000} value={rule.body_template} onChange={(event) => editRule(rule.stage, { body_template: event.target.value })} /></label>
          </fieldset>
        ))}
      </div>
      <fieldset style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12, marginTop: 12 }}>
        <legend style={{ padding: "0 5px", fontWeight: 700 }}>Preview guardrails</legend>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
          <label style={fieldStyle}>Minimum balance<input style={inputStyle} type="number" min="0" step="0.01" value={settings.minimum_balance} onChange={(event) => editSetting("minimum_balance", event.target.value)} /></label>
          <label style={fieldStyle}>Direct-owner escalation above<input style={inputStyle} type="number" min="0" step="0.01" value={settings.direct_escalation_threshold} onChange={(event) => editSetting("direct_escalation_threshold", event.target.value)} /></label>
          <label style={fieldStyle}>Send window starts<input style={inputStyle} type="time" value={settings.send_start} onChange={(event) => editSetting("send_start", event.target.value)} /></label>
          <label style={fieldStyle}>Send window ends<input style={inputStyle} type="time" value={settings.send_end} onChange={(event) => editSetting("send_end", event.target.value)} /></label>
          <label style={fieldStyle}>Firm timezone<input style={inputStyle} value={timezone} maxLength={100} onChange={(event) => setTimezone(event.target.value)} placeholder="America/Chicago" /></label>
          <label style={{ ...fieldStyle, alignContent: "center" }}><span>Schedule</span><span><input type="checkbox" checked={settings.weekdays_only} onChange={(event) => editSetting("weekdays_only", event.target.checked)} /> Weekdays only</span></label>
        </div>
        <p style={hintStyle}>The displayed schedule is configuration for the future integration. It does not start a job or send a message.</p>
      </fieldset>
      <p style={hintStyle}>If a client has no single primary contact with an email, Collections pauses that client. Choose the intended recipient in Contacts and mark that person as the primary contact; the choice is saved and audited.</p>
      <p style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <a href="/contacts" style={{ color: "var(--blue)", textDecoration: "underline" }}>Review client contacts</a>
        <button type="button" onClick={() => void submit()} disabled={saving} style={{ border: 0, borderRadius: 8, padding: "9px 14px", background: "var(--blue)", color: "white", fontWeight: 700, cursor: saving ? "wait" : "pointer", opacity: saving ? 0.65 : 1 }}>{saving ? "Saving…" : "Save rules"}</button>
        {message ? <span role="status" style={hintStyle}>{message}</span> : null}
      </p>
    </details>
  );
}
