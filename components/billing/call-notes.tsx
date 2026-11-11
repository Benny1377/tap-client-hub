"use client";

import { useEffect, useState } from "react";
import type { BillingApi } from "@/lib/billing-ui/api";
import type { CollectionEvent } from "@/lib/billing-ui/types";

const MAX_NOTE = 2000;

function when(iso: string, timeZone: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone }).format(date);
}

const noteText = (event: CollectionEvent) => (typeof event.detail?.note === "string" ? event.detail.note : "");

/** A client's call notes: internal only, never put in a client email. Uses the existing audited Collections note event. */
export function CallNotes({ api, clientId, clientName, firmTimezone, onAdded }: {
  api: BillingApi; clientId: string; clientName: string; firmTimezone: string; onAdded: () => void;
}) {
  const [notes, setNotes] = useState<CollectionEvent[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [version, setVersion] = useState(0);
  useEffect(() => {
    let current = true;
    (async () => {
      const result = await api.events(clientId, { eventType: "note", limit: 200 });
      if (!current) return;
      if (result.ok === false) { setFailed(result.message); return; }
      setFailed(null);
      setNotes(result.data.events.filter((event) => event.event_type === "note" && event.client_id === clientId));
    })();
    return () => { current = false; };
  }, [api, clientId, version]);

  const text = draft.trim();
  const save = async () => {
    if (!text || text.length > MAX_NOTE || saving) return;
    setSaving(true); setSaveError(null);
    const result = await api.logEvent({ client_id: clientId, event_type: "note", detail: { note: text } });
    setSaving(false);
    if (result.ok === false) { setSaveError(result.message); return; }
    setDraft("");
    setVersion((value) => value + 1);
    onAdded();
  };

  return (
    <div data-call-notes={clientId} style={{ padding: "4px 0 8px" }}>
      {failed ? <p className="sub" role="alert" style={{ color: "var(--red)" }}>Couldn&apos;t load notes: {failed}</p> : null}
      {notes === null && !failed ? <p className="sub" role="status">Loading notes…</p> : null}
      {notes && notes.length === 0 ? <p className="sub">No notes yet for {clientName}.</p> : null}
      {notes && notes.length > 0 ? (
        <ul style={{ listStyle: "none", margin: "0 0 10px", padding: 0 }} aria-label={`Notes for ${clientName}`}>
          {notes.map((note) => (
            <li key={note.id} data-call-note style={{ padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
              <div className="sub">{when(note.occurred_at, firmTimezone)}{note.invoice_number ? ` · invoice ${note.invoice_number}` : ""}</div>
              <div style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{noteText(note) || <span className="sub">(empty note)</span>}</div>
            </li>
          ))}
        </ul>
      ) : null}
      <label className="sub" htmlFor={`note-${clientId}`} style={{ display: "block", marginBottom: 4 }}>Add a note (internal, never sent to the client)</label>
      <textarea
        id={`note-${clientId}`}
        data-note-input
        value={draft}
        maxLength={MAX_NOTE}
        rows={2}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="e.g. Left a voicemail; they said a check goes out Friday."
        style={{ width: "100%", font: "inherit", fontSize: 13, padding: 8, border: "1px solid var(--line)", borderRadius: 8, background: "var(--card)", color: "var(--ink)" }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
        <button type="button" className="btn brand sm" data-note-save disabled={!text || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save note"}</button>
        <span className="sub">{draft.length}/{MAX_NOTE}</span>
        {saveError ? <span role="alert" style={{ color: "var(--red)", fontSize: 12.5 }}>{saveError}</span> : null}
      </div>
    </div>
  );
}
