"use client";

import { useId, useState, type CSSProperties, type ReactNode } from "react";
import type { ApiErrorKind, ApiResult } from "@/lib/billing-ui/api";
import type { FieldErrors } from "@/lib/billing-ui/validation";
import { hasErrors } from "@/lib/billing-ui/validation";
import { friendlyError, STATUS_LABELS, type SectionState } from "@/lib/billing-ui/view-model";

// Styles follow the TAP Client Hub demo (v14); table and layout classes live in app/globals.css (bc-*).
export const panelStyle: CSSProperties = { background: "var(--card)", border: "1px solid var(--line)", borderRadius: 14, padding: "22px 24px", boxShadow: "var(--shadow)", minWidth: 0 };
export const headingStyle: CSSProperties = { fontFamily: '"Fraunces",Georgia,serif', fontWeight: 600, fontSize: 16, margin: "0 0 14px" };
export const hintStyle: CSSProperties = { color: "var(--muted)", fontSize: 12.5, lineHeight: 1.5, margin: "4px 0 10px" };
const labelStyle: CSSProperties = { display: "block", fontSize: 10, fontWeight: 600, letterSpacing: ".09em", textTransform: "uppercase", color: "var(--faint)", margin: "12px 0 6px" };
// Border longhands only: mixing `border` with an error `borderColor` breaks React re-renders.
const inputStyle: CSSProperties = { width: "100%", borderWidth: 1, borderStyle: "solid", borderColor: "var(--line)", borderRadius: 8, padding: "9px 11px", fontSize: 13.5, fontFamily: "inherit", background: "var(--paper)", color: "var(--ink)", minWidth: 0 };
export const buttonStyle: CSSProperties = { border: "1px solid var(--navy)", background: "var(--navy)", color: "#fff", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" };
export const quietButtonStyle: CSSProperties = { ...buttonStyle, background: "var(--card)", color: "var(--navy)", borderColor: "var(--brand-line)" };
export const tableStyle: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
export const cellStyle: CSSProperties = { borderBottom: "1px solid var(--line2)", padding: "10px 8px", textAlign: "left", verticalAlign: "top" };

export function ErrorBanner({ kind, message, code }: { kind: ApiErrorKind; message: string; code?: string }) {
  const tone = kind === "forbidden" || kind === "unauthorized" ? { background: "var(--amber-soft)", color: "var(--amber)" } : { background: "var(--red-soft)", color: "var(--red)" };
  const { headline, detail } = friendlyError(kind, code, message);
  return (
    <div role="alert" data-error-kind={kind} data-error-code={code || undefined} style={{ ...tone, borderRadius: 10, padding: "10px 12px", fontSize: 13, margin: "8px 0" }}>
      <strong>{headline}</strong>
      {detail ? <div style={{ marginTop: 2 }}>{detail}</div> : null}
    </div>
  );
}

export function SectionView<T>({ state, label, children }: { state: SectionState<T>; label: string; children: (data: T) => ReactNode }) {
  if (state.status === "loading") return <p role="status" style={hintStyle}>Loading {label}…</p>;
  if (state.status === "error") return <ErrorBanner kind={state.kind} message={state.message} code={state.code} />;
  return <>{children(state.data)}</>;
}

// Status chips use the PracticeOps chip classes (app/practiceops.css), so they follow light and dark mode.
const STATUS_CHIP: Record<string, string> = {
  draft: "c-blue",
  issued: "c-green",
  recorded: "c-green",
  void: "c-red",
  reversed: "c-red",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span data-status={status} className={`chip ${STATUS_CHIP[status] || "c-brand"}`}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

/** One PracticeOps stat card. The value is already formatted; this component does no arithmetic. */
export function StatCard({ label, value, note, tone, testId }: { label: string; value: ReactNode; note?: ReactNode; tone?: "red" | "amber" | "green"; testId?: string }) {
  return (
    <div className="stat" data-stat={testId}>
      <div className="k">{label}</div>
      <div className="v num" style={tone ? { color: `var(--${tone})` } : undefined}>{value}</div>
      {note ? <div className="d">{note}</div> : null}
    </div>
  );
}

export function StatRow({ children, label }: { children: ReactNode; label: string }) {
  return <div className="g4" role="group" aria-label={label} style={{ marginBottom: 14 }}>{children}</div>;
}

/** The design's segmented filter. Buttons are plain toggles, so the active one is marked with aria-pressed. */
export function SegFilter<T extends string>({ options, value, onChange, label }: { options: Array<{ id: T; label: string }>; value: T; onChange: (id: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.id} type="button" className={option.id === value ? "on" : undefined} aria-pressed={option.id === value} onClick={() => onChange(option.id)}>
          {option.label}
        </button>
      ))}
    </div>
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
type ServerError = { kind: ApiErrorKind; message: string; code?: string } | null;

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
  // Several forms share field names on one page, so ids are scoped per form.
  const formId = useId();
  return (
    <form noValidate onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      {fields.map((field) => {
        const id = `${formId}-${field.name}`;
        const error = errors[field.name];
        const common = {
          id,
          name: field.name,
          "data-field": field.name,
          value: values[field.name] ?? "",
          "aria-invalid": error ? true : undefined,
          "aria-describedby": error ? `${id}-error` : undefined,
          style: { ...inputStyle, borderColor: error ? "var(--red)" : "var(--line)" },
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
      {serverError ? <ErrorBanner kind={serverError.kind} message={serverError.message} code={serverError.code} /> : null}
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
  /**
   * Clear the form after a successful save (create forms). Edit forms pass false
   * and are re-keyed on the saved record, so they never fall back to stale values.
   */
  resetOnSuccess?: boolean;
}

/**
 * What a form shows after a submit: create forms clear on success; edit forms and
 * failed submits keep what the user typed (never the stale pre-save values).
 */
export function valuesAfterSubmit(succeeded: boolean, current: FormValues, initial: FormValues, resetOnSuccess: boolean) {
  return succeeded && resetOnSuccess ? initial : current;
}

export function LedgerForm({ fields, initialValues, validate, onSubmit, submitLabel, resetOnSuccess = true }: LedgerFormProps) {
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
    if (result.ok === false) setServerError({ kind: result.kind, message: result.message, code: result.code });
    setValues(valuesAfterSubmit(result.ok === true, values, initialValues, resetOnSuccess));
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
    <label className="bc-picker">
      <span>Client</span>
      <select value={value || ""} onChange={(event) => onChange(event.target.value || null)} style={{ ...inputStyle, background: "var(--card)", width: "auto", minWidth: 220, maxWidth: "100%" }}>
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
          if (result.ok === false) setError({ kind: result.kind, message: result.message, code: result.code });
        }}
      >
        {pending ? "Working…" : label}
      </button>
      {error ? <ErrorBanner kind={error.kind} message={error.message} code={error.code} /> : null}
    </span>
  );
}

/** A two-step action: open it, read what will happen, then confirm. */
export function ConfirmAction({ label, description, confirmLabel, onConfirm, testId }: {
  label: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<ApiResult<unknown>>;
  testId?: string;
}) {
  return (
    <details data-confirm-action={testId}>
      <summary style={{ cursor: "pointer", fontSize: 12.5, color: "var(--red)", fontWeight: 600 }}>{label}</summary>
      <p style={{ ...hintStyle, margin: "4px 0 6px" }}>{description}</p>
      <ActionButton label={confirmLabel} onAction={onConfirm} />
    </details>
  );
}
