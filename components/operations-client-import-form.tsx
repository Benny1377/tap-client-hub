"use client";

import { useState } from "react";
import { parseOperationsClientCsv, type OperationsImportPayload } from "@/lib/operations-client-import";

type ImportResult = {
  ok?: boolean;
  mode?: string;
  clients?: number;
  matched_existing?: number;
  would_create?: number;
  contacts?: number;
  clients_created?: number;
  clients_updated?: number;
  contacts_created?: number;
  contacts_updated?: number;
  primary_flags_updated?: number;
  conflicts?: Array<{ reason?: string; candidate_count?: number }>;
  error?: string;
};

export default function OperationsClientImportForm() {
  const [payload, setPayload] = useState<OperationsImportPayload | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);

  async function chooseFile(file?: File) {
    setError("");
    setResult(null);
    setPayload(null);
    if (!file) return;
    try {
      setPayload(parseOperationsClientCsv(await file.text()));
      setFileName(file.name);
    } catch (caught) {
      setFileName("");
      setError(caught instanceof Error ? caught.message : "Could not read that CSV.");
    }
  }

  async function submit(mode: "preview" | "apply") {
    if (!payload || busy) return;
    if (mode === "apply" && !window.confirm(`Import ${payload.clients.length} client records and ${payload.contacts.length} contacts into the Collections sandbox? Existing exact matches will be updated from Operations. This will not touch production.`)) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/clients/operations-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, payload }),
      });
      const body = await response.json() as ImportResult;
      if (!response.ok) throw new Error(body.error || body.conflicts?.[0]?.reason || `Import request failed (${response.status}).`);
      setResult(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Import request failed.");
    } finally {
      setBusy(false);
    }
  }

  const hasConflicts = !!result?.conflicts?.length;
  return (
    <section className="space-y-4 rounded-xl border border-slate-300 p-6">
      <label className="block space-y-2 text-sm font-medium">
        Operations clients-and-contacts CSV
        <input className="block w-full rounded border p-2" type="file" accept=".csv,text/csv" onChange={(event) => void chooseFile(event.currentTarget.files?.[0])} />
      </label>
      {payload && <p className="text-sm">Loaded {fileName}: <strong>{payload.clients.length}</strong> clients and <strong>{payload.contacts.length}</strong> contacts.</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {result && <div role="status" className="space-y-2 text-sm">
        {result.mode === "preview" ? <p>Preview: {result.matched_existing} exact existing matches, {result.would_create} new clients, {result.contacts} contacts.</p> : <p>Import complete: {result.clients_created} clients created, {result.clients_updated} matched clients updated, {result.contacts_created} contacts added, {result.contacts_updated} contacts refreshed, {result.primary_flags_updated} primary flags updated.</p>}
        {hasConflicts && <div className="text-red-700"><p>Resolve these source-data conflicts before applying:</p><ul className="list-disc pl-5">{result.conflicts?.map((conflict, index) => <li key={`${conflict.reason}-${index}`}>{conflict.reason || "identity_conflict"}{conflict.candidate_count ? ` (${conflict.candidate_count} candidates)` : ""}</li>)}</ul></div>}
      </div>}
      <div className="flex flex-wrap gap-3">
        <button className="rounded bg-slate-800 px-4 py-2 text-white disabled:opacity-50" disabled={!payload || busy} onClick={() => void submit("preview")} type="button">{busy ? "Working…" : "Preview matches"}</button>
        <button className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-50" disabled={!payload || busy || !result?.ok || result.mode !== "preview" || hasConflicts} onClick={() => void submit("apply")} type="button">Apply to sandbox</button>
      </div>
    </section>
  );
}
