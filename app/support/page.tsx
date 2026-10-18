"use client";

import { useMemo, useState } from "react";

const SUPPORT_EMAILS = ["support@aifusioniqlabs.com"];
const SUPPORT_EMAIL = SUPPORT_EMAILS.join(", ");
const SUPPORT_PHONE = "(832) 937-4786";

const SUP_AREAS = [
  "Clients", "Financials", "Payroll", "Sales Tax", "1099s", "Renditions",
  "Team Workload", "Password Vault", "Adding / editing a client", "Login or access", "Something else",
];

export default function SupportPage() {
  const [name, setName] = useState("");
  const [firm, setFirm] = useState("TAP Associates");
  const [area, setArea] = useState("");
  const [summary, setSummary] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [what, setWhat] = useState("");
  const [expected, setExpected] = useState("");
  const [steps, setSteps] = useState("");
  const [shot, setShot] = useState(false);
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState<{ ticketNumber: string; emailSent: boolean } | null>(null);
  const [submissionError, setSubmissionError] = useState("");

  const subjectPreview = useMemo(() => {
    const client = firm.trim() || "TAP Associates";
    const sum = summary.trim() || "(brief summary of the issue)";
    return `${client}: ${urgent ? "URGENT: " : ""}${sum}`;
  }, [firm, summary, urgent]);

  function buildBody() {
    return [
      `Reported by: ${name || "(your name)"}`,
      `Account: ${firm || "TAP Associates"}`,
      `Area of the app: ${area || "(not specified)"}`,
      `Priority: ${urgent ? "URGENT" : "Normal"}`,
      "",
      "WHAT HAPPENED",
      what || "(describe what went wrong)",
      "",
      "WHAT I EXPECTED",
      expected || "(what you expected to happen)",
      "",
      "STEPS TO REPRODUCE",
      steps || "1. \n2. \n3. ",
      "",
      `Screenshot sent separately: ${shot ? "Yes" : "No"}`,
    ].join("\n");
  }

  async function submitRequest() {
    setSubmissionError("");
    setSubmitted(null);

    const missingFields = [
      !name.trim() && "your name",
      !summary.trim() && "a brief summary",
      !what.trim() && "what happened",
    ].filter(Boolean);
    if (missingFields.length > 0) {
      setSubmissionError(`Please enter ${missingFields.join(", ")}.`);
      return;
    }

    setSending(true);
    try {
      const response = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reporterName: name,
          accountFirm: firm,
          appArea: area,
          summary,
          urgent,
          whatHappened: what,
          expectedResult: expected,
          reproductionSteps: steps,
          screenshotConfirmed: shot,
        }),
      });
      const responseBody = await response.json().catch(() => null);
      if (!response.ok || !responseBody?.ticket?.number) {
        throw new Error(responseBody?.error || "Unable to create the support ticket. Please try again.");
      }
      setSubmitted({ ticketNumber: responseBody.ticket.number, emailSent: responseBody.emailSent === true });
    } catch (error) {
      setSubmissionError(error instanceof Error ? error.message : "Unable to send the support request. Please try again.");
    } finally {
      setSending(false);
    }
  }

  async function copyRequest() {
    const body = buildBody();
    const text = `To: ${SUPPORT_EMAIL}\nSubject: ${subjectPreview}\n\n${body}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
  }

  return (
    <div>
      <div className="supgrid" style={{ display: "flex", gap: 16, alignItems: "flex-start", marginTop: 16 }}>
        <div className="supmain" style={{ flex: 2, minWidth: 0 }}>
          <div className="panel" style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 16, overflow: "hidden", padding: "20px 22px" }}>
            <div className="suph" style={{ fontFamily: '"Fraunces",Georgia,serif', fontWeight: 600, fontSize: 21 }}>Open a support ticket</div>
            <div className="suphint" style={{ color: "var(--muted)", fontSize: "13.5px", margin: "5px 0 14px", lineHeight: 1.5 }}>
              Fill this in to create a tracked support ticket. We will reply with your ticket number.
            </div>

            <div className="shot-note" style={{ display: "flex", gap: 10, background: "var(--amber-soft)", border: "1px solid var(--amber-line)", color: "var(--amber)", borderRadius: 12, padding: "12px 14px", fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
              <span style={{ fontSize: 18 }}>&#128206;</span>
              <div><b>Screenshots are helpful.</b> This form does not upload files, so please send any screenshot separately if needed. Confirming it here gives the support team useful context.</div>
            </div>

            <div className="sup2" style={{ display: "flex", gap: 12, margin: 0 }}>
              <div style={{ flex: 1 }}>
                <span className="sl" style={slStyle}>Your name</span>
                <input style={supInputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Lizette" />
              </div>
              <div style={{ flex: 1 }}>
                <span className="sl" style={slStyle}>Account / firm</span>
                <input style={supInputStyle} value={firm} onChange={e => setFirm(e.target.value)} />
              </div>
            </div>

            <span className="sl" style={slStyle}>Where in the app?</span>
            <select style={supInputStyle} value={area} onChange={e => setArea(e.target.value)}>
              <option value="">Choose the area</option>
              {SUP_AREAS.map(a => <option key={a}>{a}</option>)}
            </select>

            <span className="sl" style={slStyle}>Brief summary <span className="opt" style={{ fontWeight: 500, color: "var(--muted)", textTransform: "none", letterSpacing: 0 }}>(this becomes the subject line)</span></span>
            <input style={supInputStyle} value={summary} onChange={e => setSummary(e.target.value)} placeholder="e.g. Can't save a new payroll client" />

            <label className="urgrow" style={{ display: "flex", alignItems: "center", gap: 9, margin: "14px 0 2px", fontSize: "13.5px", cursor: "pointer", background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: "11px 13px" }}>
              <input type="checkbox" checked={urgent} onChange={e => setUrgent(e.target.checked)} style={{ width: "auto" }} />
              <span><b>This is urgent:</b> it&apos;s blocking work right now</span>
            </label>

            <span className="sl" style={slStyle}>What happened?</span>
            <textarea style={supInputStyle} rows={3} value={what} onChange={e => setWhat(e.target.value)} placeholder="Describe what you were doing and what went wrong." />

            <span className="sl" style={slStyle}>What did you expect to happen? <span className="opt" style={{ fontWeight: 500, color: "var(--muted)", textTransform: "none", letterSpacing: 0 }}>(optional)</span></span>
            <textarea style={supInputStyle} rows={2} value={expected} onChange={e => setExpected(e.target.value)} placeholder="What you thought the app would do." />

            <span className="sl" style={slStyle}>Steps to reproduce <span className="opt" style={{ fontWeight: 500, color: "var(--muted)", textTransform: "none", letterSpacing: 0 }}>(optional, but very helpful)</span></span>
            <textarea style={supInputStyle} rows={3} value={steps} onChange={e => setSteps(e.target.value)} placeholder="1. Opened a client\n2. Switched Payroll on\n3. Clicked Save…" />

            <label className="urgrow" style={{ display: "flex", alignItems: "center", gap: 9, margin: "14px 0 2px", fontSize: "13.5px", cursor: "pointer", background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: "11px 13px" }}>
              <input type="checkbox" checked={shot} onChange={e => setShot(e.target.checked)} style={{ width: "auto" }} />
              <span>I have sent or will send a screenshot separately if needed</span>
            </label>

            <div className="subjbox" style={{ marginTop: 16, background: "var(--card2)", border: "1px dashed var(--brand-line)", borderRadius: 11, padding: "11px 14px" }}>
              <span style={{ fontSize: "10.5px", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)" }}>Subject preview</span>
              <div style={{ fontSize: "13.5px", marginTop: 4, color: "var(--ink)", wordBreak: "break-word", fontVariantNumeric: "tabular-nums" }}>{subjectPreview}</div>
            </div>

            {submissionError && <p role="alert" style={{ color: "var(--red)", fontSize: 13, margin: "12px 0 0" }}>{submissionError}</p>}
            {submitted && <p role="status" style={{ color: "var(--green)", fontSize: 13, margin: "12px 0 0" }}><b>Ticket {submitted.ticketNumber} created.</b> It is now tracked in TAP Hub.{submitted.emailSent ? " The support team has also been notified by email." : " The support team will see it in TAP Hub."}</p>}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
              <button className="btn" disabled={sending} onClick={submitRequest} style={btnStyle(true, sending)}>{sending ? "Sending request..." : "✉️ Send request to support"}</button>
              <button className="btn alt" style={btnStyle(false)} onClick={copyRequest}>⧇ Copy request instead</button>
            </div>
          </div>
        </div>

        <div className="supside" style={{ flex: 1, minWidth: 240, display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="panel supcontact" style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 16, overflow: "hidden", padding: "18px 20px" }}>
            <div className="suph2" style={{ fontFamily: '"Fraunces",Georgia,serif', fontWeight: 600, fontSize: 16, marginBottom: 12 }}>Reach our team</div>
            <a className="contact" href="mailto:support@aifusioniqlabs.com" style={contactStyle}>
              <span className="ci" style={{ width: 34, height: 34, borderRadius: 9, background: "var(--teal-soft)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>✉️</span>
              <div><div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".05em" }}>Email</div><div style={{ fontWeight: 600, fontSize: "13.5px" }}>{SUPPORT_EMAIL}</div></div>
            </a>
            <a className="contact" href="tel:+183****4786" style={contactStyle}>
              <span className="ci" style={{ width: 34, height: 34, borderRadius: 9, background: "var(--teal-soft)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>📞</span>
              <div><div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".05em" }}>Phone</div><div style={{ fontWeight: 600, fontSize: "13.5px" }}>{SUPPORT_PHONE}</div></div>
            </a>
            <div className="provby" style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, textAlign: "center" }}>Support provided by <b style={{ color: "var(--teal)" }}>AI Fusion IQ Labs</b></div>
          </div>

          <div className="panel" style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 16, overflow: "hidden", padding: "18px 20px" }}>
            <div className="suph2" style={{ fontFamily: '"Fraunces",Georgia,serif', fontWeight: 600, fontSize: 16, marginBottom: 12 }}>How support works</div>
            {[
              ["1", "Send your request", "Use the form, or email us directly. Urgent issues: call the number above."],
              ["2", "We open a ticket", "You'll get a ticket number by email so you can track it."],
              ["3", "We need the details", "What went wrong, what you expected, and a screenshot. The more we have, the faster we fix it."],
              ["4", "We resolve & follow up", "We'll reply on the same ticket and confirm once it's sorted."],
            ].map(([n, t, d]) => (
              <div key={n} className="step" style={{ display: "flex", gap: 11, padding: "8px 0", borderBottom: "1px solid var(--card2)" }}>
                <div className="stepn" style={{ flex: "0 0 24px", height: 24, borderRadius: "50%", background: "var(--teal)", color: "#fff", fontWeight: 700, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>{n}</div>
                <div><div className="stept" style={{ fontWeight: 600, fontSize: "13.5px" }}>{t}</div><div className="stepd" style={{ fontSize: "12.5px", color: "var(--muted)", lineHeight: 1.45, marginTop: 1 }}>{d}</div></div>
              </div>
            ))}
          </div>

          <div className="panel" style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 16, overflow: "hidden", padding: "16px 20px" }}>
            <div className="suph2" style={{ fontFamily: '"Fraunces",Georgia,serif', fontWeight: 600, fontSize: 16, marginBottom: 12 }}>Good subject lines</div>
            <div className="egood" style={{ fontSize: "12.5px", color: "var(--green)", marginBottom: 6 }}>✓ <span className="mono" style={{ fontVariantNumeric: "tabular-nums", color: "var(--ink)" }}>303A Properties: Monthly report won't open</span></div>
            <div className="egood" style={{ fontSize: "12.5px", color: "var(--green)", marginBottom: 6 }}>✓ <span className="mono" style={{ fontVariantNumeric: "tabular-nums", color: "var(--ink)" }}>TAP Associates: URGENT: can't log in</span></div>
            <div className="ebad" style={{ fontSize: "12.5px", color: "var(--red)" }}>✗ <span className="mono" style={{ fontVariantNumeric: "tabular-nums", color: "var(--ink)" }}>help</span> &middot; <span className="mono" style={{ fontVariantNumeric: "tabular-nums", color: "var(--ink)" }}>it's broken</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

const slStyle: React.CSSProperties = { display: "block", fontSize: "11.5px", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)", margin: "14px 0 5px" };
const supInputStyle: React.CSSProperties = { width: "100%", padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 10, font: "inherit", fontSize: 14, background: "var(--card)", resize: "vertical" };
const contactStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12, padding: "11px 12px", border: "1px solid var(--line)", borderRadius: 11, marginBottom: 9, textDecoration: "none", color: "var(--ink)", transition: ".12s" };
const btnStyle = (primary: boolean, disabled = false): React.CSSProperties => ({ all: "unset", cursor: disabled ? "wait" : "pointer", opacity: disabled ? 0.65 : 1, background: primary ? "var(--ink)" : "var(--card)", color: primary ? "#fff" : "var(--ink)", border: primary ? "none" : "1px solid var(--line)", padding: "10px 16px", borderRadius: 11, fontWeight: 600, fontSize: "13.5px", display: "inline-flex", gap: 7, alignItems: "center" });
