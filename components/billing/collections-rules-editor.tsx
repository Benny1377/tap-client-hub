"use client";

import { useState } from "react";
import type { CollectionsRuleUpdate, CollectionsSettingsUpdate } from "@/lib/collections-api";
import type { ApiResult } from "@/lib/billing-ui/api";
import type { CollectionRuleSettings } from "@/lib/billing-ui/types";

const MERGE_FIELDS = ["{contact_name}", "{invoice_number}", "{balance}", "{due_date}", "{days_past_due}"];

/** Owner/Admin "Setup & rules": the ladder, wording, and guardrails. Nothing here sends or schedules anything. */
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
  // drop the "Rules saved" confirmation after each save.
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
    <div data-collections-rules-editor>
      <p className="bc-sub" style={{ margin: "-4px 0 22px" }}>
        <b style={{ color: "var(--ink)" }}>Owner/Admin · Configure Collections rules.</b> The ladder runs exactly the way the firm decides.
        Stage and balance rules change the worklist and preview right away; nothing is sent or scheduled here.
      </p>

      <section className="bc-cfgsec" aria-label="The follow-up ladder">
        <h3 className="bc-sect">The follow-up ladder</h3>
        <p className="bc-hint">When each touch is due, and whether a reminder may go automatically or always waits for approval. Email delivery is still off, so &ldquo;Send automatically&rdquo; only changes what the preview proposes.</p>
        <div className="bc-cfgladder">
          {rules.map((rule) => (
            <div key={rule.stage} className={`bc-cfgrung${rule.stage >= 4 ? " gate" : ""}`} data-rule-stage={rule.stage}>
              <div className="tone">Touch {rule.stage}{rule.stage >= 4 ? <> <span className="bc-gatetag" style={{ marginTop: 0 }}>⚑ gate</span></> : null}</div>
              <label className="bc-field"><span>Label</span>
                <input className="bc-in" maxLength={80} value={rule.label} onChange={(event) => editRule(rule.stage, { label: event.target.value })} />
              </label>
              <label className="bc-field"><span>Trigger · days past due</span>
                <span className="bc-inline">
                  <input className="bc-in sm" type="number" min={1} max={3650} value={rule.days_past_due} onChange={(event) => editRule(rule.stage, { days_past_due: Number(event.target.value) })} />
                  <span className="bc-when">day {rule.days_past_due}</span>
                </span>
              </label>
              {rule.stage <= 3 ? (
                <label className="bc-field"><span>Sending</span>
                  <select className="bc-in" value={rule.automatic ? "auto" : "approve"} onChange={(event) => editRule(rule.stage, { automatic: event.target.value === "auto" })}>
                    <option value="auto">Send automatically</option>
                    <option value="approve">Hold for approval</option>
                  </select>
                </label>
              ) : <p className="bc-note" style={{ margin: "0 0 10px" }}>Always manual; Owner/Admin approval required.</p>}
              <label className="bc-tog" style={{ margin: 0 }}>
                <input type="checkbox" checked={rule.enabled} onChange={(event) => editRule(rule.stage, { enabled: event.target.checked })} /> Use this touch
              </label>
            </div>
          ))}
        </div>
      </section>

      <section className="bc-cfgsec" aria-label="Email templates">
        <h3 className="bc-sect">Email templates</h3>
        <p className="bc-hint">The wording each touch will use under the firm&rsquo;s name. Merge fields: {MERGE_FIELDS.map((field) => <span key={field} className="bc-chip">{field}</span>)}</p>
        <div className="bc-mails">
          {rules.map((rule) => (
            <div key={rule.stage} className="bc-cfgcard">
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Touch {rule.stage} · {rule.label}{rule.stage >= 4 ? <> <span className="bc-gatetag" style={{ marginTop: 0 }}>⚑ gate</span></> : null}</div>
              <label className="bc-field" style={{ marginTop: 10 }}><span>Subject template</span>
                <input className="bc-in" maxLength={240} value={rule.subject_template} onChange={(event) => editRule(rule.stage, { subject_template: event.target.value })} />
              </label>
              <label className="bc-field"><span>Message template</span>
                <textarea className="bc-in" maxLength={8000} value={rule.body_template} onChange={(event) => editRule(rule.stage, { body_template: event.target.value })} />
              </label>
            </div>
          ))}
        </div>
      </section>

      <section className="bc-cfgsec" aria-label="Guardrails">
        <h3 className="bc-sect">Guardrails</h3>
        <p className="bc-hint">Keep the ladder sensible about who and when to chase.</p>
        <div className="bc-grid2">
          <div className="bc-cfgcard">
            <label className="bc-field"><span>Don&rsquo;t chase balances under</span>
              <span className="bc-inline"><span className="bc-muted">$</span><input className="bc-in sm" type="number" min="0" step="0.01" value={settings.minimum_balance} onChange={(event) => editSetting("minimum_balance", event.target.value)} /></span>
            </label>
            <div className="bc-note">Small invoices aren&rsquo;t worth the friction.</div>
          </div>
          <div className="bc-cfgcard">
            <label className="bc-field"><span>Direct-owner escalation above</span>
              <span className="bc-inline"><span className="bc-muted">$</span><input className="bc-in" style={{ width: 120 }} type="number" min="0" step="0.01" value={settings.direct_escalation_threshold} onChange={(event) => editSetting("direct_escalation_threshold", event.target.value)} /></span>
            </label>
            <div className="bc-note">Big balances skip the reminders and come straight to an Owner or Admin.</div>
          </div>
          <div className="bc-cfgcard">
            <span className="bc-label">Send window</span>
            <span className="bc-inline">
              <input className="bc-in" style={{ width: 120 }} type="time" aria-label="Send window starts" value={settings.send_start} onChange={(event) => editSetting("send_start", event.target.value)} />
              <span className="bc-muted">to</span>
              <input className="bc-in" style={{ width: 120 }} type="time" aria-label="Send window ends" value={settings.send_end} onChange={(event) => editSetting("send_end", event.target.value)} />
            </span>
            <label className="bc-tog"><input type="checkbox" checked={settings.weekdays_only} onChange={(event) => editSetting("weekdays_only", event.target.checked)} /> Weekdays only</label>
            <label className="bc-field" style={{ margin: 0 }}><span>Firm timezone</span>
              <input className="bc-in" value={timezone} maxLength={100} onChange={(event) => setTimezone(event.target.value)} placeholder="America/Chicago" />
            </label>
            <div className="bc-note">Stored for the future integration. It does not start a job or send a message.</div>
          </div>
          <div className="bc-cfgcard">
            <span className="bc-label">Who gets chased</span>
            <p className="bc-hint" style={{ margin: 0 }}>Reminders go to each client&rsquo;s one primary contact. If a client has no single primary contact with an email, Collections pauses that client until someone chooses one.</p>
            <p style={{ margin: "10px 0 0" }}><a href="/contacts" style={{ color: "var(--navy)", fontWeight: 600, fontSize: 13 }}>Review client contacts →</a></p>
          </div>
        </div>
      </section>

      <section className="bc-cfgsec" aria-label="Sender and routing">
        <h3 className="bc-sect">Sender &amp; routing</h3>
        <div className="bc-cfgcard locked">
          <span className="bc-label">Set on the server</span>
          <p className="bc-hint" style={{ margin: 0 }}>The sending address, reply-to, and test mailbox are set on the server, never in this editor. &ldquo;Email delivery&rdquo; below shows what is configured; clients never receive email in this phase.</p>
        </div>
      </section>

      <div className="bc-savebar">
        <button type="button" className="bc-btn" onClick={() => void submit()} disabled={saving}>{saving ? "Saving…" : "Save rules"}</button>
        {message ? <span role="status" className="bc-hint" style={{ margin: 0 }}>{message}</span> : null}
      </div>
    </div>
  );
}
