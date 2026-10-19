"use client";

import { useEffect, useRef, useState } from "react";
import type { Client, ServiceKey } from "@/lib/types";
import { SERVICE_META } from "@/lib/data";
import { calculatePayrollStartDate } from "@/lib/payroll-schedule";

interface ClientModalProps {
  open: boolean;
  client?: Client | null;
  onClose: () => void;
  onSave: (client: Client | Omit<Client, "id" | "cid">) => Promise<void> | void;
}

/**
 * Active staff for the "Assigned to" choices, from the profile directory (the same
 * source the client panel uses). The value is the profile's full name, which is
 * what /api/clients matches on.
 */
function useStaffNames(): string[] {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/profile-directory")
      .then(r => (r.ok ? r.json() : []))
      .then((data: unknown) => {
        if (cancelled || !Array.isArray(data)) return;
        setNames(data
          .filter((u: { status?: string; name?: string }) => u.status === "Active" && u.name)
          .map((u: { name: string }) => u.name));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return [...names, "Unassigned"];
}

// ── Phone normalization helper ──
function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits.startsWith("1")) return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  // Return only digits if it contains letters or junk and no recognizable number.
  if (/[a-zA-Z]/.test(value)) return digits || "";
  return value;
}

function isInvalidPhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  // Allow short/non-US values only if empty; mark letters or <10 digits as invalid.
  return /[a-zA-Z]/.test(value) || (digits.length > 0 && digits.length < 10);
}

const FILING_TYPES = ["C Corp.", "S Corp.", "Partnership", "SMLLC", "Personal", "Trust", "Non Profit", "Retirem Plan"];

export default function ClientModal({ open, client, onClose, onSave }: ClientModalProps) {
  const staffNames = useStaffNames();
  const isEdit = !!client;

  const [previewCid] = useState(() => "TP|BS|" + String(Math.floor(1000 + Math.random() * 9000)).padStart(4, "0"));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // ── Form fields ──
  const [name, setName] = useState("");
  const [type, setType] = useState<"Business" | "Personal">("Business");
  const [group, setGroup] = useState("");
  const [contact, setContact] = useState("");
  const [assigned, setAssigned] = useState("Unassigned");
  const [email, setEmail] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [addPhone, setAddPhone] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [st, setSt] = useState("TX");
  const [zip, setZip] = useState("");

  // ── Service toggles ──
  const [fin, setFin] = useState(false);
  const [pr, setPr] = useState(false);
  const [stx, setStx] = useState(false);
  const [t9, setT9] = useState(false);
  const [rend, setRend] = useState(false);
  const [tax, setTax] = useState(false);
  const [finFreq, setFinFreq] = useState("Monthly");
  const [finMonth, setFinMonth] = useState("1");

  // ── Pay Day options (all options, no cadence filtering) ──
  const payDayOptions = [
    // From Google Sheet (normalized)
    "15th/EOM","16th/EOM","25th","5th/20th","EOM",
    "Fridays","Saturdays","Thursdays",
    // Weekdays (deduped — sheet already covers Fri/Sat/Thu)
    "Monday","Tuesday","Wednesday","Sunday",
  ];

  // Shared payroll business-calendar calculation keeps modal saves aligned with the worklist.
  const calcPayrollStartDate = calculatePayrollStartDate;

  const [prFreq, setPrFreq] = useState("Bi-Weekly A");
  const [prPaydate, setPrPaydate] = useState("");
  const [prPin, setPrPin] = useState("");
  const [prEftps, setPrEftps] = useState("");
  const [prProcessor, setPrProcessor] = useState("");
  const [clientEin, setClientEin] = useState("");
  const [prReportingNotes, setPrReportingNotes] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [showEftps, setShowEftps] = useState(false);
  const [prProcessorOther, setPrProcessorOther] = useState("");
  const [prEmails, setPrEmails] = useState<string[]>([]);
  const prEmailInputRef = useRef<HTMLInputElement>(null);
  const [stxFreq, setStxFreq] = useState("Monthly");
  // Sales tax line items
  const [stxLineItems, setStxLineItems] = useState<any[]>([]);
  const [newStxName, setNewStxName] = useState("");
  const [newStxRt, setNewStxRt] = useState("");
  const [newStxTaxId, setNewStxTaxId] = useState("");
  const [newStxBank, setNewStxBank] = useState("");
  const [newStxRouting, setNewStxRouting] = useState("");
  const [newStxAccount, setNewStxAccount] = useState("");
  const [newStxFreq, setNewStxFreq] = useState("Monthly");
  const [newStxAssigned, setNewStxAssigned] = useState("");
  const [t9Count, setT9Count] = useState("");
  const [taxType, setTaxType] = useState("Business");
  const [taxFilingMonth, setTaxFilingMonth] = useState("");
  const [taxFilingState, setTaxFilingState] = useState("");
  const [taxFilingType, setTaxFilingType] = useState("");
  // ── Multi-state renewal items ──
  const [stateRenewalItems, setStateRenewalItems] = useState<any[]>([]);
  const [addingRenewal, setAddingRenewal] = useState(false);
  const [newRenewalState, setNewRenewalState] = useState("TX");
  const [newRenewalMonth, setNewRenewalMonth] = useState("");
  const [newRenewalDay, setNewRenewalDay] = useState("");
  const [newRenewalIds, setNewRenewalIds] = useState("");
  const [newRenewalAssigned, setNewRenewalAssigned] = useState("Unassigned");

  // Per-service assigned staff
  const [finAssigned, setFinAssigned] = useState("Unassigned");
  const [prAssigned, setPrAssigned] = useState("Unassigned");
  const [t9Assigned, setT9Assigned] = useState("Unassigned");
  const [rendAssigned, setRendAssigned] = useState("Unassigned");
  const [taxAssigned, setTaxAssigned] = useState("Unassigned");

  useEffect(() => {
    if (client) {
      setName(client.name);
      setType(client.type);
      setGroup(client.group || client.groupName || "");
      setContact(client.contact || "");
      setAssigned(client.assignedStaff || "Unassigned");
      setEmail((client.emails || [""])[0] || "");
      setAddEmail((client.emails || [])[1] || "");
      setPhone((client.phones || [""])[0] || "");
      setAddPhone((client.phones || [])[1] || "");
      setAddress(client.address || "");
      setCity(client.city || "");
      setSt(client.state || "TX");
      setZip((client as any).zip || "");
      const svcs = client.services || [];
      setFin(svcs.find(s => s.key === "financials")?.enabled || false);
      setPr(svcs.find(s => s.key === "payroll")?.enabled || false);
      setStx(svcs.find(s => s.key === "sales_tax")?.enabled || false);
      setT9(svcs.find(s => s.key === "1099s")?.enabled || false);
      setRend(svcs.find(s => s.key === "renditions")?.enabled || false);
      setTax(svcs.find(s => s.key === "tax_returns")?.enabled || false);
      // Restore service-specific fields
      const finSvc = svcs.find(s => s.key === "financials");
      if (finSvc) { setFinFreq(finSvc.frequency || "Monthly"); setFinMonth(String(finSvc.financialsMonth || 1)); }
      const prSvc = svcs.find(s => s.key === "payroll");
      if (prSvc) { setPrFreq(prSvc.frequency || "Bi-Weekly A"); setPrPaydate(prSvc.paydate || ""); setPrPin(prSvc.payrollPassword || ""); setPrEftps(prSvc.eftps || ""); setPrProcessor(prSvc.processor || ""); setPrProcessorOther(prSvc.processorOther || ""); setPrEmails(Array.isArray(prSvc.payEmails) ? prSvc.payEmails : []); setPrReportingNotes(prSvc.reportingNotes || ""); }
      setClientEin(client.ein || "");
      const t9Svc = svcs.find(s => s.key === "1099s");
      if (t9Svc) setT9Count(String(t9Svc.expectedAnnual || ""));
      // Restore sales tax line items
      const stxSvc = svcs.find(s => s.key === "sales_tax");
      if (stxSvc) setStxLineItems(stxSvc.salesTaxLineItems || []);
      const trSvc = svcs.find(s => s.key === "tax_returns");
      if (trSvc) {
        const rendSvc = svcs.find((s: any) => s.key === "renditions");
        setTaxFilingMonth(trSvc.filingMonth || "");
        setTaxFilingState(trSvc.filingState || "");
        setTaxFilingType(trSvc.filingType || "");
        const rendSvcEdit = svcs.find((s: any) => s.key === "renditions");
        setStateRenewalItems(rendSvcEdit?.stateRenewalItems || []);
      }
    } else {
      setName(""); setType("Business"); setGroup(""); setContact(""); setAssigned("Unassigned");
      setEmail(""); setAddEmail(""); setPhone(""); setAddPhone("");
      setAddress(""); setCity(""); setSt("TX"); setZip("");
      setFin(false); setPr(false); setStx(false); setT9(false); setRend(false); setTax(false);
      setFinFreq("Monthly"); setFinMonth("1"); setPrFreq("Bi-Weekly A"); setPrPaydate(""); setPrPin(""); setPrEftps(""); setPrProcessor(""); setPrProcessorOther(""); setPrReportingNotes("");
      setStxFreq("Monthly"); setT9Count(""); setTaxType("Business"); setClientEin("");
      setTaxFilingMonth(""); setTaxFilingState("");
      setTaxFilingType(""); setStateRenewalItems([]);
      setStxLineItems([]); setNewStxName(""); setNewStxRt(""); setNewStxTaxId(""); setNewStxBank(""); setNewStxRouting(""); setNewStxAccount(""); setNewStxFreq("Monthly"); setNewStxAssigned("");
      setFinAssigned("Unassigned"); setPrAssigned("Unassigned");
      setT9Assigned("Unassigned"); setRendAssigned("Unassigned"); setTaxAssigned("Unassigned");
    }
  }, [client, open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSave() {
    const nm = name.trim();
    if (!nm) return;
    if (isInvalidPhone(phone) || isInvalidPhone(addPhone)) {
      setSaveError("Please fix the phone number(s) before saving.");
      return;
    }
    setSaving(true);
    setSaveError("");
    const svcs: any[] = [];
    function addSvc(
      key: ServiceKey, enabled: boolean, frequency: string,
      assignedTo: string, extra?: Record<string, any>
    ) {
      if (!enabled) return;
      svcs.push({
        key, enabled: true, frequency,
        assignedTo: assignedTo || "Unassigned",
        months: Array(12).fill("lock"),
        ...extra,
      });
    }
    // Order: Fin → PR → STX → 1099s → Rend → Tax
    addSvc("financials", fin, finFreq, finAssigned, {
      financialsMonth: finFreq === "Yearly" ? parseInt(finMonth) || 1 : undefined,
    });
    addSvc("payroll", pr, prFreq, prAssigned, {
      paydate: prPaydate || null,
      payrollPassword: prPin || null,
      eftps: prEftps || null,
      processor: prProcessor || null,
      payEmails: prEmails.length > 0 ? prEmails : undefined,
      reportingNotes: prReportingNotes,
      financialsMonth: finFreq === "Yearly" ? parseInt(finMonth) || 1 : undefined,
    });
    addSvc("sales_tax", stx, stxFreq, "Unassigned", {
      salesTaxLineItems: stxLineItems.length > 0 ? stxLineItems : undefined,
    });
    addSvc("1099s", t9, "Yearly", t9Assigned, {
      expectedAnnual: t9Count ? parseInt(t9Count) : undefined,
    });
    addSvc("renditions", rend, "Yearly", rendAssigned);
    if (stateRenewalItems.length > 0 && rend) {
      addSvc("annual_reports", true, "Yearly", "Unassigned", {
        stateRenewal: true,
        stateRenewalItems,
      });
    }
    addSvc("tax_returns", tax, "Yearly", taxAssigned, {
      processor: taxType,
      filingMonth: taxFilingMonth || null,
      filingState: taxFilingState || null,
      filingType: taxFilingType || null,
    });

    try {
      await onSave({
        name: nm, type: type as "Business" | "Personal", status: "active",
        group: group.trim(),
        contact: contact.trim(),
        emails: [email, addEmail].filter(Boolean),
        phones: [phone, addPhone].filter(Boolean),
        address, city, state: st, zip,
        ein: clientEin.trim(),
        services: svcs.length ? svcs : [],
      } as any);
      onClose();
    } catch (error) {
      console.error("Add client failed:", error);
      setSaveError(error instanceof Error ? error.message : "Unable to save client services. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mscrim show" style={{
      position: "fixed", inset: 0, background: "rgba(33,31,26,0.4)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 60, padding: 20,
    }} onClick={onClose}>
      <div className="modal" style={{
        background: "var(--paper)", borderRadius: 18, width: 480, maxWidth: "100%",
        maxHeight: "90vh", overflowY: "auto", boxShadow: "var(--shadow)",
      }} onClick={e => e.stopPropagation()}>
        <h2 style={{
          fontFamily: '"Fraunces",Georgia,serif', fontSize: 22, fontWeight: 600,
          padding: "20px 24px 4px", margin: 0, color: "var(--ink)",
        }}>
          {isEdit ? "Edit client" : "Add a client"}
        </h2>
        <div className="msub" style={{
          color: "var(--muted)", fontSize: 13, padding: "0 24px 14px",
          borderBottom: "1px solid var(--line)",
        }}>
          Fill this once — they&apos;ll appear in the right worklists automatically.
        </div>

        <div className="mform" style={{ padding: "18px 24px" }}>
          {/* CID box */}


          {/* ── Client section ── */}
          <div className="fsect" style={fsectStyle}>Client</div>
          <label style={labelStyle}>Client / entity name</label>
          <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Sunrise Holdings LLC" autoFocus />
          <div className="two" style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Type</label>
              <select style={inputStyle} value={type} onChange={e => { const v = e.target.value; if (v === "Business" || v === "Personal") setType(v); }}>
                <option value="Business">Business</option><option value="Personal">Personal</option>
              </select>
            </div>
          </div>

          <label style={labelStyle}>Group name</label>
          <input style={inputStyle} value={group} onChange={e => setGroup(e.target.value)} placeholder="e.g. Baljit Gambhir, Jamil Hasan" />
          <label style={labelStyle}>Contact name</label>
          <input style={inputStyle} value={contact} onChange={e => setContact(e.target.value)} placeholder="Primary contact person" />

          {/* ── Contact section ── */}
          <div className="fsect" style={fsectStyle}>Contact</div>
          <label style={labelStyle}>Email</label>
          <input style={inputStyle} value={email} onChange={e => setEmail(e.target.value)} placeholder="client@email.com" />
          <label style={labelStyle}>Additional email <span className="opt" style={{ fontWeight: 500, color: "var(--muted)", textTransform: "none", letterSpacing: 0 }}>(optional)</span></label>
          <input style={inputStyle} value={addEmail} onChange={e => setAddEmail(e.target.value)} placeholder="cc@email.com" />
          <label style={labelStyle}>Phone</label>
          <input style={{ ...inputStyle, borderColor: isInvalidPhone(phone) ? "var(--red,var(--red))" : undefined }} value={phone} onChange={e => setPhone(e.target.value)} onBlur={e => setPhone(normalizePhone(e.target.value))} placeholder="(713) 555-0100" />
          {isInvalidPhone(phone) && <div style={{ color: "var(--red,var(--red))", fontSize: 12, marginTop: 4 }}>Enter a valid 10-digit phone number.</div>}
          <label style={labelStyle}>Additional phone <span className="opt" style={{ fontWeight: 500, color: "var(--muted)", textTransform: "none", letterSpacing: 0 }}>(optional)</span></label>
          <input style={{ ...inputStyle, borderColor: isInvalidPhone(addPhone) ? "var(--red,var(--red))" : undefined }} value={addPhone} onChange={e => setAddPhone(e.target.value)} onBlur={e => setAddPhone(normalizePhone(e.target.value))} placeholder="(713) 555-0200" />
          {isInvalidPhone(addPhone) && <div style={{ color: "var(--red,var(--red))", fontSize: 12, marginTop: 4 }}>Enter a valid 10-digit phone number.</div>}
          <label style={labelStyle}>Street address</label>
          <input style={inputStyle} value={address} onChange={e => setAddress(e.target.value)} placeholder="123 Main St." />
          <div className="two" style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 2 }}>
              <label style={labelStyle}>City</label>
              <input style={inputStyle} value={city} onChange={e => setCity(e.target.value)} placeholder="Houston" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>State</label>
              <select style={inputStyle} value={st} onChange={e => setSt(e.target.value)}>
                {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>ZIP</label>
              <input style={inputStyle} value={String(zip).replace(/\.0+$/, "")} onChange={e => setZip(e.target.value.replace(/\D/g, ""))} placeholder="77002" />
            </div>
          </div>
          {/* ── Services section (order: Fin → PR → STX → T9 → Rend → Tax) ── */}
          <div className="fsect" style={fsectStyle}>Services <span className="opt" style={{ fontWeight: 500, color: "var(--muted)", textTransform: "none", letterSpacing: 0, fontFamily: '"Public Sans",sans-serif' }}>— tick what you do for them; details appear as you tick</span></div>

          {/* Financials */}
          <ServiceCard icon="📊" label="Financials" checked={fin} onChange={setFin}>
            <div className="two" style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ ...labelStyle, marginTop: 8 }}>Frequency</label>
                <select style={inputStyle} value={finFreq} onChange={e => setFinFreq(e.target.value)}>
                  <option value="Monthly">Monthly</option><option value="Quarterly">Quarterly</option><option value="Yearly">Yearly</option>
                </select>
              </div>
            </div>
            {finFreq === "Yearly" && (
              <div style={{ marginTop: 8 }}>
                <label style={labelStyle}>Processing month</label>
                <select style={inputStyle} value={finMonth} onChange={e => setFinMonth(e.target.value)}>
                  {["January","February","March","April","May","June",
                    "July","August","September","October","November","December"].map((m, i) => (
                    <option key={m} value={String(i+1)}>{m}</option>
                  ))}
                </select>
              </div>
            )}
            <label style={{ ...labelStyle, marginTop: 8 }}>Assigned to</label>
            <select style={inputStyle} value={finAssigned} onChange={e => setFinAssigned(e.target.value)}>
              {staffNames.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </ServiceCard>

          {/* Payroll */}
          <ServiceCard icon="💵" label="Payroll" checked={pr} onChange={setPr}>
            <div style={{ marginTop: 8 }}>
              <label style={labelStyle}>EIN</label>
              <input style={inputStyle} value={clientEin} onChange={e => setClientEin(e.target.value)} placeholder="XX-XXXXXXX" />
            </div>
            <div style={{ marginTop: 8 }}>
              <label style={labelStyle}>Notes</label>
              <textarea style={{ ...inputStyle, minHeight: 64, resize: "vertical" }} value={prReportingNotes} onChange={e => setPrReportingNotes(e.target.value)} placeholder="Add payroll notes..." />
            </div>
            <div className="two" style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ ...labelStyle, marginTop: 8 }}>Frequency</label>
                <select style={inputStyle} value={prFreq} onChange={e => {
                  const newFreq = e.target.value;
                  setPrFreq(newFreq);
                  // Recalculate start date
                  const newStart = calcPayrollStartDate(newFreq, prPaydate);
                }}>
                  <option value="Weekly">Weekly</option><option value="Bi-Weekly A">Bi-Weekly A</option><option value="Bi-Weekly B">Bi-Weekly B</option><option value="Semi-Monthly">Semi-Monthly</option><option value="Monthly">Monthly</option><option value="Quarterly">Quarterly</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ ...labelStyle, marginTop: 8 }}>Pay date / day</label>
                <select style={inputStyle} value={prPaydate} onChange={e => {
                  setPrPaydate(e.target.value);
                  // Calculate start date dynamically
                  const newStart = calcPayrollStartDate(prFreq, e.target.value);
                }}>
                  <option value="">-</option>
                  {(payDayOptions).map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="two" style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Payroll PIN</label>
                <div style={{ position: "relative" }}>
                  <input style={{ ...inputStyle, paddingRight: 40 }} type={showPin ? "text" : "password"} value={prPin} onChange={e => setPrPin(e.target.value)} placeholder="EFT pin" />
                  <button type="button" onClick={() => setShowPin(v => !v)} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex", alignItems: "center", color: "var(--muted)" }}>
                    {showPin ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/></svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    )}
                  </button>
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>EPTPS Password</label>
                <div style={{ position: "relative" }}>
                  <input style={{ ...inputStyle, paddingRight: 40 }} type={showEftps ? "text" : "password"} value={prEftps} onChange={e => setPrEftps(e.target.value)} placeholder="EFTPS password" />
                  <button type="button" onClick={() => setShowEftps(v => !v)} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex", alignItems: "center", color: "var(--muted)" }}>
                    {showEftps ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/></svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    )}
                  </button>
                </div>
              </div>
            </div>
            <div style={{ marginTop: 8 }}>
              <label style={labelStyle}>Processor</label>
              <select style={inputStyle} value={prProcessor} onChange={e => setPrProcessor(e.target.value)}>
                <option value="">— Select —</option>
                <option value="Quickbooks Desktop 24">Quickbooks Desktop 24</option>
                <option value="Quickbooks Desktop">Quickbooks Desktop</option>
                <option value="ADP">ADP</option>
                <option value="QBO">QBO</option>
              </select>
            </div>
            <div style={{ marginTop: 8 }}>
              <label style={labelStyle}>Payroll Emails</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "4px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13, background: "var(--card)", minHeight: 30 }}>
                  {prEmails.map((em, i) => (
                    <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 3, background: "var(--blue-soft)", color: "var(--blue)", borderRadius: 6, padding: "3px 8px", fontSize: 11, fontWeight: 600, justifyContent: "space-between" }}>
                      {em}
                      <button type="button" onClick={() => setPrEmails(prev => prev.filter((_, j) => j !== i))} style={{ all: "unset", cursor: "pointer", lineHeight: 1, fontSize: 13, marginLeft: 4, opacity: 0.7 }}>×</button>
                    </span>
                  ))}
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <input
                      ref={prEmailInputRef}
                      style={{ border: "none", outline: "none", fontSize: 12, flex: 1, background: "transparent" }}
                      placeholder="Type email + Enter"
                      onKeyDown={e => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const val = (e.target as HTMLInputElement).value.trim();
                          if (val && !prEmails.includes(val)) setPrEmails(prev => [...prev, val]);
                          (e.target as HTMLInputElement).value = "";
                        }
                      }}
                    />
                    <button type="button"
                      onClick={() => {
                        const inp = prEmailInputRef.current as HTMLInputElement | null;
                        if (!inp) return;
                        const val = inp.value.trim();
                        if (val && !prEmails.includes(val)) setPrEmails(prev => [...prev, val]);
                        inp.value = "";
                        inp.focus();
                      }}
                      style={{ all: "unset", cursor: "pointer", padding: "2px 8px", background: "var(--ink)", color: "var(--paper)", borderRadius: 6, fontSize: 16, fontWeight: 700, lineHeight: 1 }}>+</button>
                  </div>
              </div>
            </div>
            <label style={{ ...labelStyle, marginTop: 8 }}>Assigned to</label>
            <select style={inputStyle} value={prAssigned} onChange={e => setPrAssigned(e.target.value)}>
              {staffNames.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </ServiceCard>

          {/* Sales Tax */}
          <ServiceCard icon="🧾" label="Sales Tax" checked={stx} onChange={setStx}>
            <label style={{ ...labelStyle, marginTop: 8 }}>Cadence</label>
            <select style={inputStyle} value={stxFreq} onChange={e => setStxFreq(e.target.value)}>
              <option value="Monthly">Monthly</option><option value="Quarterly">Quarterly</option><option value="Yearly">Yearly</option>
            </select>

            {/* Sales tax line items — always visible when Sales Tax is checked */}
            <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
              <label style={{ ...labelStyle, margin: 0, fontSize: 11, marginBottom: 8, display: "block" }}>Add line item</label>
              <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 12, marginBottom: 8 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Service name <span style={{ color: "var(--red,var(--red))" }}>*</span></label>
                    <input style={{ width: "100%", padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13 }} value={newStxName} onChange={e => setNewStxName(e.target.value)} placeholder="e.g. Texas Sales Tax" />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>RT <span style={{ color: "var(--red,var(--red))" }}>*</span></label>
                    <input style={{ width: "100%", padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13 }} value={newStxRt} onChange={e => setNewStxRt(e.target.value)} placeholder="e.g. 123456" />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Frequency</label>
                    <select style={{ width: "100%", padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13 }} value={newStxFreq} onChange={e => setNewStxFreq(e.target.value)}>
                      <option value="Monthly">Monthly</option><option value="Quarterly">Quarterly</option><option value="Yearly">Yearly</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Tax ID <span style={{ color: "var(--red,var(--red))" }}>*</span></label>
                    <input style={{ width: "100%", padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13 }} value={newStxTaxId} onChange={e => setNewStxTaxId(e.target.value)} placeholder="e.g. 74-1234567" />
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Bank name</label>
                    <input style={{ width: "100%", padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13 }} value={newStxBank} onChange={e => setNewStxBank(e.target.value)} placeholder="e.g. Chase" />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Routing #</label>
                    <input style={{ width: "100%", padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13 }} value={newStxRouting} onChange={e => setNewStxRouting(e.target.value)} placeholder="e.g. 111000025" />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Account #</label>
                    <input style={{ width: "100%", padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13 }} value={newStxAccount} onChange={e => setNewStxAccount(e.target.value)} placeholder="e.g. 123456789" />
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Assigned to</label>
                    <select style={{ width: "100%", padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13 }}
                      value={newStxAssigned} onChange={e => setNewStxAssigned(e.target.value)}>
                      <option value="">—</option>
                      {staffNames.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
                <button
                  disabled={!newStxName.trim() || !newStxRt.trim() || !newStxTaxId.trim()}
                  style={{
                    all: "unset", cursor: "pointer", padding: "7px 14px", borderRadius: 8, fontWeight: 600, fontSize: 13,
                    background: (!newStxName.trim() || !newStxRt.trim() || !newStxTaxId.trim()) ? "var(--line,var(--line))" : "var(--ink)",
                    color: (!newStxName.trim() || !newStxRt.trim() || !newStxTaxId.trim()) ? "var(--muted,var(--faint))" : "#fff",
                  }}
                  onClick={() => {
                    setStxLineItems(prev => [...prev, {
                      serviceName: newStxName.trim(), rt: newStxRt.trim(), taxId: newStxTaxId.trim(),
                      bankName: newStxBank.trim(), bankRouting: newStxRouting.trim(), bankAccount: newStxAccount.trim(),
                      assignedTo: newStxAssigned,
                      frequency: newStxFreq,
                    }]);
                    setNewStxName(""); setNewStxRt(""); setNewStxTaxId(""); setNewStxBank("");
                    setNewStxRouting(""); setNewStxAccount(""); setNewStxFreq("Monthly"); setNewStxAssigned("");
                  }}
                >
                  + Add line item
                </button>
              </div>

              {stxLineItems.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {stxLineItems.map((item: any, i: number) => (
                    <div key={i} style={{
                      display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center",
                      background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8, padding: "9px 11px",
                    }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 3 }}>{item.serviceName}</div>
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 11, color: "var(--muted)" }}>
                          {item.assignedTo && <span>👤 {item.assignedTo}</span>}
                          <span>{item.frequency || "Monthly"}</span>
                          {item.rt && <span>RT: {item.rt}</span>}
                          {item.taxId && <span>Tax ID: {item.taxId}</span>}
                          {item.bankName && <span>{item.bankName}</span>}
                        </div>
                      </div>
                      <button
                        style={{ all: "unset", cursor: "pointer", color: "var(--red)", fontWeight: 600, fontSize: 12 }}
                        onClick={() => setStxLineItems(prev => prev.filter((_, j) => j !== i))}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </ServiceCard>

          {/* 1099 Filing */}
          <ServiceCard icon="📄" label="1099 Filing" checked={t9} onChange={setT9}>
            <div style={{ marginTop: 8 }}>
              <label style={labelStyle}>Expected annual count</label>
              <input style={inputStyle} type="number" value={t9Count} onChange={e => setT9Count(e.target.value)} placeholder="e.g. 15" min="0" />
            </div>
            <label style={{ ...labelStyle, marginTop: 8 }}>Assigned to</label>
            <select style={inputStyle} value={t9Assigned} onChange={e => setT9Assigned(e.target.value)}>
              {staffNames.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </ServiceCard>

          {/* Annual Reports */}
          <ServiceCard icon="📄" label="Annual Reports" checked={rend} onChange={setRend}>
            {/* State renewal — multi-state support */}
            <label style={{ ...labelStyle, marginTop: 12, fontWeight: 600 }}>State Renewals</label>
            {stateRenewalItems.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                {stateRenewalItems.map((item: any, idx: number) => (
                  <div key={idx} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 6px", background: "var(--paper)", borderRadius: 6, fontSize: 12 }}>
                    <span style={{ fontWeight: 600, minWidth: 30 }}>{item.state}</span>
                    <span style={{ color: "var(--muted)", fontSize: 11 }}>
                      Due: {item.dueMonth ? MONTH_NAMES[Math.max(0, Math.min(11, parseInt(item.dueMonth || "1") - 1))] : "—"}{item.dueDay ? ` ${item.dueDay}` : ""}
                    </span>
                    <span style={{ color: "var(--muted)", fontSize: 10, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.identifiers || ""}</span>
                    <button onClick={() => setStateRenewalItems(prev => prev.filter((_, i) => i !== idx))}
                      style={{ all: "unset", cursor: "pointer", color: "var(--red)", fontSize: 14, lineHeight: 1, padding: "0 2px" }}
                      title="Remove">×</button>
                  </div>
                ))}
              </div>
            )}
            {addingRenewal ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <div style={{ flex: 1 }}>
                    <select style={inputStyle} value={newRenewalState} onChange={e => setNewRenewalState(e.target.value)}>
                      <option value="">State</option>
                      {US_STATES.map(st => <option key={st} value={st}>{st}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <select style={inputStyle} value={newRenewalMonth} onChange={e => setNewRenewalMonth(e.target.value)}>
                      <option value="">Month</option>
                      {MONTH_NAMES.map((m, i) => <option key={i} value={String(i + 1)}>{m}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: 0.6 }}>
                    <input style={inputStyle} type="number" value={newRenewalDay} onChange={e => setNewRenewalDay(e.target.value)} placeholder="Day" min="1" max="31" />
                  </div>
                </div>
                <input style={inputStyle} value={newRenewalIds} onChange={e => setNewRenewalIds(e.target.value)} placeholder="IDs (e.g. EIN, state IDs)" />
                <select style={inputStyle} value={newRenewalAssigned} onChange={e => setNewRenewalAssigned(e.target.value)}>
                  {staffNames.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setAddingRenewal(false)}
                    style={{ all: "unset", cursor: "pointer", padding: "4px 10px", borderRadius: 6, fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>Cancel</button>
                  <button onClick={() => {
                    if (!newRenewalState) return;
                    setStateRenewalItems(prev => [...prev, {
                      state: newRenewalState, dueMonth: newRenewalMonth, dueDay: newRenewalDay,
                      identifiers: newRenewalIds, assignedTo: newRenewalAssigned, frequency: "Yearly",
                    }]);
                    setNewRenewalState("TX"); setNewRenewalMonth(""); setNewRenewalDay("");
                    setNewRenewalIds(""); setNewRenewalAssigned("Unassigned");
                    setAddingRenewal(false);
                  }}
                    style={{ all: "unset", cursor: "pointer", padding: "4px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: "var(--ink)", color: "var(--paper)" }}>Add</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setAddingRenewal(true)}
                style={{ all: "unset", cursor: "pointer", marginTop: 6, padding: "6px 12px", border: "1px dashed var(--line)", borderRadius: 8, fontSize: 12, fontWeight: 600, color: "var(--teal)", width: "100%", boxSizing: "border-box", textAlign: "center" }}>
                + Add state
              </button>
            )}
          </ServiceCard>

          {/* Tax Return (last) */}
          <ServiceCard icon="📋" label="Tax Return" checked={tax} onChange={setTax}>
            <label style={{ ...labelStyle, marginTop: 8 }}>Filing type</label>
            <select style={inputStyle} value={taxFilingType} onChange={e => setTaxFilingType(e.target.value)}>
              {FILING_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <label style={{ ...labelStyle, marginTop: 8 }}>Assigned to</label>
            <select style={inputStyle} value={taxAssigned} onChange={e => setTaxAssigned(e.target.value)}>
              {staffNames.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <div className="two" style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ ...labelStyle, marginTop: 8 }}>Filing Month</label>
                <select style={inputStyle} value={taxFilingMonth} onChange={e => setTaxFilingMonth(e.target.value)}>
                  <option value="">—</option>
                  {MONTH_NAMES.map((m, i) => <option key={i} value={String(i + 1)}>{m}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ ...labelStyle, marginTop: 8 }}>Filing State</label>
                <select style={inputStyle} value={taxFilingState} onChange={e => setTaxFilingState(e.target.value)}>
                  <option value="">—</option>
                  {US_STATES.map(st => <option key={st} value={st}>{st}</option>)}
                </select>
              </div>
            </div>
          </ServiceCard>
        </div>

        <div className="mfoot" style={{
          padding: "6px 24px 22px", display: "flex", gap: 10, justifyContent: "flex-end",
        }}>
          {saveError && <div role="alert" style={{ alignSelf: "center", color: "var(--red)", fontSize: 12, marginRight: "auto" }}>{saveError}</div>}
          <button className="btn alt" onClick={onClose} disabled={saving} style={btnStyle(false)}>Cancel</button>
          <button className="btn" onClick={handleSave} disabled={saving} style={btnStyle(true)}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "＋ Add client"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Service card (checkbox toggle → expandable sub) ──
function ServiceCard({ icon, label, checked, onChange, children }: {
  icon: string; label: string; checked: boolean; onChange: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="svccard" style={{
      background: "var(--card)", border: "1px solid var(--line)", borderRadius: 11,
      marginBottom: 8, overflow: "hidden",
    }}>
      <label className="svctop" style={{
        display: "flex", alignItems: "center", gap: 10, padding: "11px 13px",
        margin: 0, cursor: "pointer", fontSize: 14, fontWeight: 600,
        color: "var(--ink)", textTransform: "none", letterSpacing: 0,
      }}>
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ width: "auto" }} />
        <span style={{ fontSize: 16 }}>{icon}</span><span>{label}</span>
      </label>
      {children && (
        <div className={`svcsub${checked ? " open" : ""}`} style={{
          maxHeight: checked ? 9999 : 0, opacity: checked ? 1 : 0,
          padding: checked ? "6px 13px 13px" : "0 13px",
          transition: ".18s", background: "var(--card2)",
          borderTop: checked ? "1px solid var(--line)" : "none",
          overflow: "hidden",
        }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ── Shared constants ──
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];

// ── Shared styles ──
const fsectStyle: React.CSSProperties = {
  fontFamily: '"Fraunces",Georgia,serif', fontWeight: 600, fontSize: 15,
  color: "var(--ink)", margin: "20px 0 6px", paddingBottom: 6,
  borderBottom: "1px solid var(--line)",
};
const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted)",
  margin: "12px 0 5px", textTransform: "uppercase", letterSpacing: ".04em",
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", border: "1px solid var(--line)",
  borderRadius: 10, font: "inherit", fontSize: 14, background: "var(--card)",
  color: "var(--ink)",
};
const btnStyle = (primary: boolean): React.CSSProperties => ({
  all: "unset", cursor: "pointer",
  background: primary ? "var(--ink)" : "var(--card)",
  color: primary ? "#fff" : "var(--ink)",
  border: primary ? "none" : "1px solid var(--line)",
  padding: "10px 16px", borderRadius: 11,
  fontWeight: 600, fontSize: "13.5px", display: "inline-flex", gap: 7, alignItems: "center",
});
