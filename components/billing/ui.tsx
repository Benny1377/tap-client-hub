"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import type { ApiErrorKind, ApiResult } from "@/lib/billing-ui/api";
import type { FieldErrors } from "@/lib/billing-ui/validation";
import { hasErrors } from "@/lib/billing-ui/validation";
import { errorHeadline, STATUS_LABELS, type SectionState } from "@/lib/billing-ui/view-model";

export const panelStyle: CSSProperties = { background: "var(--card)", border: "1px solid var(--line)", borderRadius: 16, padding: "18px 20px", minWidth: 0 };
export const headingStyle: CSSProperties = { fontFamily: '"Fraunces",Georgia,serif', fontWeight: 600, fontSize: 19, margin: "0 0 10px" };
export const hintStyle: CSSProperties = { color: "var(--muted)", fontSize: 13, lineHeight: 1.5, margin: "4px 0 10px" };
const labelStyle: CSSProperties = { display: "block", fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)", margin: "10px 0 4px" };
const inputStyle: CSSProperties = { width: "100%", border: "1px solid var(--line)", borderRadius: 10, padding: "8px 10px", fontSize: 14, background: "#fff", color: "var(--ink)" };
export const buttonStyle: CSSProperties = { border: "1px solid var(--teal)", background: "var(--teal)", color: "#fff", borderRadius: 10, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
export const quietButtonStyle: CSSProperties = { ...buttonStyle, background: "#fff", color: "var(--teal)" };
export const tableStyle: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13.5 };
export const cellStyle: CSSProperties = { borderBottom: "1px solid var(--line)", padding: "8px 6px", textAlign: "left", verticalAlign: "top" };

export function ErrorBanner({ kind, message }: { kind: ApiErrorKind; message: string }) {
  const tone = kind === "forbidden" || kind === "unauthorized" ? { background: "var(--amber-soft)", color: "#7a5210" } : { background: "var(--red-soft)", color: "var(--red)" };
  return (
    <div role="alert" data-error-kind={kind} style={{ ...tone, borderRadius: 10, padding: "10px 12px", fontSize: 13, margin: "8px 0" }}>
      <strong>{errorHeadline(kind)}</strong>
      {message ? <div style={{ marginTop: 2 }}>{message}</div> : null}
    </div>
  );
}

export function SectionView<T>({ state, label, children }: { state: SectionState<T>; label: string; children: (data: T) => ReactNode }) {
  if (state.status === "loading") return <p role="status" style={hintStyle}>Loading {label}…</p>;
  if (state.status === "error") return <ErrorBanner kind={state.kind} message={state.message} />;
  return <>{children(state.data)}</>;
}

export function StatusBadge({ status }: { status: string }) {
  const tones: Record<string, CSSProperties> = {
    draft: { background: "var(--blue-soft)", color: "var(--blue)" },
    issued: { background: "var(--green-soft)", color: "var(--green)" },
    recorded: { background: "var(--green-soft)", color: "var(--green)" },
    void: { background: "var(--red-soft)", color: "var(--red)" },
    reversed: { background: "var(--red-soft)", color: "var(--red)" },
  };
  return (
    <span data-status={status} style={{ ...(tones[status] || { background: "var(--teal-soft)", color: "var(--teal-ink)" }), borderRadius: 999, padding: "2px 9px", fontSize: 12, fontWeight: 600 }}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

/** Explains an action the server reserves for Owner/Admin instead of offering a button that would 403. */
export function OwnerAdminOnly({ action }: { action: string }) {
  return <span data-approval-boundary="owner-admin" style={{ fontSize: 12.5, color: "var(--muted)" }}>{action} requires Owner/Admin.</span>;
}

export interface FieldConfig {
  name: string;
  label: string;
  type?: "text" | "date" | "month" | "select" | "textarea";
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
  optional?: boolean;
}

export type FormValues = Record<string, string>;
type ServerError = { kind: ApiErrorKind; message: string } | null;

export interface LedgerFormViewProps {
  fields: FieldConfig[];
  values: FormValues;
  errors: FieldErrors;
  serverError: ServerError;
  submitting: boolean;
  submitLabel: string;
  onChange: (name: string, value: string) => void;
  onSubmit: () => void;
}

export function LedgerFormView({ fields, values, errors, serverError, submitting, submitLabel, onChange, onSubmit }: LedgerFormViewProps) {
  return (
    <form noValidate onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      {fields.map((field) => {
        const id = `field-${field.name}`;
        const error = errors[field.name];
        const common = {
          id,
          name: field.name,
          value: values[field.name] ?? "",
          "aria-invalid": error ? true : undefined,
          "aria-describedby": error ? `${id}-error` : undefined,
          style: { ...inputStyle, ...(error ? { borderColor: "var(--red)" } : {}) },
          onChange: (event: { target: { value: string } }) => onChange(field.name, event.target.value),
        };
        return (
          <div key={field.name}>
            <label htmlFor={id} style={labelStyle}>
              {field.label}
              {field.optional ? <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0 }}> (optional)</span> : null}
            </label>
            {field.type === "select" ? (
              <select {...common}>
                <option value="">Select…</option>
                {(field.options || []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            ) : field.type === "textarea" ? (
              <textarea {...common} rows={2} placeholder={field.placeholder} />
            ) : (
              <input {...common} type={field.type || "text"} placeholder={field.placeholder} />
            )}
            {error ? <div id={`${id}-error`} data-field-error={field.name} style={{ color: "var(--red)", fontSize: 12.5, marginTop: 3 }}>{error}</div> : null}
          </div>
        );
      })}
      {serverError ? <ErrorBanner kind={serverError.kind} message={serverError.message} /> : null}
      <button type="submit" disabled={submitting} style={{ ...buttonStyle, marginTop: 12, opacity: submitting ? 0.6 : 1 }}>
        {submitting ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}

export interface LedgerFormProps {
  fields: FieldConfig[];
  initialValues: FormValues;
  validate: (values: FormValues) => FieldErrors;
  onSubmit: (values: FormValues) => Promise<ApiResult<unknown>>;
  submitLabel: string;
}

export function LedgerForm({ fields, initialValues, validate, onSubmit, submitLabel }: LedgerFormProps) {
  const [values, setValues] = useState<FormValues>(initialValues);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<ServerError>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    const nextErrors = validate(values);
    setErrors(nextErrors);
    setServerError(null);
    if (hasErrors(nextErrors)) return;
    setSubmitting(true);
    const result = await onSubmit(values);
    setSubmitting(false);
    if (result.ok === false) setServerError({ kind: result.kind, message: result.message });
    else setValues(initialValues);
  }

  return (
    <LedgerFormView
      fields={fields}
      values={values}
      errors={errors}
      serverError={serverError}
      submitting={submitting}
      submitLabel={submitLabel}
      onChange={(name, value) => setValues((current) => ({ ...current, [name]: value }))}
      onSubmit={submit}
    />
  );
}

export function ClientPicker({ clients, value, onChange }: { clients: Array<{ id: string; name: string }>; value: string | null; onChange: (id: string | null) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 }}>
      <span style={{ color: "var(--muted)" }}>Client</span>
      <select value={value || ""} onChange={(event) => onChange(event.target.value || null)} style={{ ...inputStyle, width: "auto", minWidth: 220, maxWidth: "100%" }}>
        <option value="">All clients</option>
        {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
      </select>
    </label>
  );
}

/** A one-click mutation button that shows the server's error next to it. */
export function ActionButton({ label, onAction, quiet }: { label: string; onAction: () => Promise<ApiResult<unknown>>; quiet?: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ServerError>(null);
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button
        type="button"
        disabled={pending}
        style={{ ...(quiet ? quietButtonStyle : buttonStyle), opacity: pending ? 0.6 : 1 }}
        onClick={async () => {
          setPending(true);
          setError(null);
          const result = await onAction();
          setPending(false);
          if (result.ok === false) setError({ kind: result.kind, message: result.message });
        }}
      >
        {pending ? "Working…" : label}
      </button>
      {error ? <ErrorBanner kind={error.kind} message={error.message} /> : null}
    </span>
  );
}
