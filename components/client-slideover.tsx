"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Client, ServiceKey, CommentEntry, SalesTaxLineItem } from "@/lib/types";
import { SERVICE_META, STAFF } from "@/lib/data";
import { PAY_DAY_OPTIONS, calculatePayrollStartDate, normalizePayDay, formatPayrollStartDate } from "@/lib/payroll-schedule";

// ── Utility: display stored banking references in the authorized client view ──
function displayBankNumber(val: string | undefined | null): string {
  if (!val) return "—";
  return val;
}

// ── Constants ──
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const FILING_TYPES = ["C Corp.", "S Corp.", "Partnership", "SMLLC", "Personal", "Trust", "Non Profit", "Retirem Plan"];
const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

  // ── Stage display for month tracking in the slideover ──
const UNIFIED_STAGES = [
  { k: "pp", t: "✓", cls: "prep", l: "Prepared" },
  { k: "dn", t: "✓", cls: "done", l: "Done" },
];
const NA_STAGE = { k: "na", t: "–", cls: "na", l: "N/A" };

const NOTE_TYPES = ["Delayed", "Waiting on client", "Issues", "others"];

// ── Phone normalization helper ──
function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits.startsWith("1")) return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  if (/[a-zA-Z]/.test(value)) return digits || "";
  return value;
}

function isInvalidPhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return /[a-zA-Z]/.test(value) || (digits.length > 0 && digits.length < 10);
}

const STAGE_STYLES: Record<string, { bg: string; fg: string; border: string; cls: string; label: string }> = {
  "":   { bg: "transparent", fg: "#c2c8d4", border: "transparent", cls: "lock", label: "Not due" },
  ip:   { bg: "var(--blue-soft)", fg: "var(--blue)", border: "#bcd0e2", cls: "prog", label: "In progress" },
  wc:   { bg: "var(--amber-soft)", fg: "var(--amber)", border: "#e8d3a6", cls: "wait", label: "Waiting on client" },
  pp:   { bg: "var(--teal-soft)", fg: "var(--teal-ink)", border: "#c5d0ec", cls: "prep", label: "Prepared" },
  dl:   { bg: "var(--red-soft)", fg: "var(--red)", border: "#e8c4bf", cls: "delay", label: "Delayed" },
  dn:   { bg: "var(--green-soft)", fg: "var(--green)", border: "#bcdcc6", cls: "done", label: "Done" },
  na:   { bg: "var(--red-soft)", fg: "var(--red)", border: "#e8c4bf", cls: "na", label: "N/A" },
};

// ── Module labels ──
const svcMeta: Record<string, { label: string; ic: string; bg: string }> = {
  financials:  { label: "Financials", ic: "📊", bg: "var(--green-soft)" },
  payroll:     { label: "Payroll", ic: "💵", bg: "var(--blue-soft)" },
  sales_tax:   { label: "Sales Tax", ic: "🧾", bg: "var(--amber-soft)" },
  tax_returns: { label: "Tax Return", ic: "📋", bg: "#ece7f3" },
  "1099s":     { label: "1099 Filing", ic: "📄", bg: "#f0e8e2" },
  renditions:       { label: "Renditions",  ic: "🏠", bg: "#e7eee8" },
  annual_reports:   { label: "Annual Reports", ic: "📄", bg: "#e7eee8" },
};
const svcLabel = (k: string) => svcMeta[k]?.label || k;
const svcIc = (k: string) => svcMeta[k]?.ic || "📋";
const svcBg = (k: string) => svcMeta[k]?.bg || "var(--teal-soft)";

// Annual Reports owns state renewal items. Fall back to the legacy Renditions
// service only for clients that do not yet have an Annual Reports service row.
function findRenewalService(services: any[]) {
  return services.find((s: any) => s.key === "annual_reports" && s.csId)
    || services.find((s: any) => s.key === "renditions" && s.csId)
    || services.find((s: any) => s.key === "annual_reports")
    || services.find((s: any) => s.key === "renditions");
}

interface ClientSlideoverProps {
  client: Client;
  open: boolean;
  onClose: () => void;
  onSave?: (client: Client) => void;
  onDelete?: (clientId: string) => void;
  onStageChange?: (clientId: string, serviceKey: string, monthIdx: number, stage: string) => void;
  moduleKey?: ServiceKey | "annual_reports";
  currentUser?: string;
  canEditClientData?: boolean;
  stxLineItemFocus?: string | null;
}

export default function ClientSlideover({ client, open, onClose, onSave, onDelete, onStageChange, moduleKey, currentUser, canEditClientData = true, stxLineItemFocus }: ClientSlideoverProps) {
  // Resolve virtual module keys to real service keys (annual_reports is now its own key)
  const resolvedKey = moduleKey === "annual_reports" ? "annual_reports" : moduleKey;
  const isWorklistTab = !!moduleKey;
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollPosRef = useRef(0);
  const clientRef = useRef(client.id);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [localSvcs, setLocalSvcs] = useState<any[]>(client.services);

  // ── Refs for debounced autosave ──
  const saveTimerRef = useRef<any>(null);
  const pendingSaveRef = useRef<any>(null);
  const dirtyRef = useRef(false);
  const clientIdRef = useRef(client.id);
  const pendingClientIdRef = useRef<string | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;


  /** Debounced autosave: accumulates data and fires onSave after 800ms of inactivity */
  const autoSave = useCallback((data: any) => {
    if (!canEditClientData) return;
    // Guard: skip if client ID changed (prevents cross-client save)
    if (clientIdRef.current !== client.id) return;
    pendingSaveRef.current = data;
    pendingClientIdRef.current = client.id;
    dirtyRef.current = true;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      if (dirtyRef.current && clientIdRef.current === client.id) {
        onSaveRef.current?.(pendingSaveRef.current);
      }
      pendingSaveRef.current = null;
      pendingClientIdRef.current = null;
      dirtyRef.current = false;
    }, 800);
  }, [client.id, canEditClientData]);

  /** Flush any pending save immediately. Call before onClose. */
  const flushSave = useCallback(() => {
    if (!canEditClientData) return;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (dirtyRef.current && pendingSaveRef.current && pendingClientIdRef.current === clientIdRef.current && clientIdRef.current === client.id) {
      onSaveRef.current?.(pendingSaveRef.current);
    }
    pendingSaveRef.current = null;
    pendingClientIdRef.current = null;
    dirtyRef.current = false;
  }, [client.id, canEditClientData]);

  // ── Client switch: clear pending state before stale data could leak ──
  useEffect(() => {
    // Clear pending payload, timer, and dirty flag when switching clients
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    pendingSaveRef.current = null;
    pendingClientIdRef.current = null;
    dirtyRef.current = false;
    clientIdRef.current = client.id;
  }, [client.id]);

  // ── Cleanup timer on unmount: only flush if pending data belongs to this client ──
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      // Only flush if pending data still belongs to this exact client instance
      if (dirtyRef.current && pendingSaveRef.current && pendingClientIdRef.current === clientIdRef.current) {
        onSaveRef.current?.(pendingSaveRef.current);
      }
      pendingSaveRef.current = null;
      pendingClientIdRef.current = null;
      dirtyRef.current = false;
    };
  }, []);
  const addPrEmail = () => {
    const val = newPrEmailRef.current?.value.trim();
    if (!val) return;
    const upd = [...prEmails, val];
    setPrEmails(upd);
    setLocalSvcs(prev => prev.map((s: any) => s.key === "payroll" ? { ...s, payEmails: upd } : s));
    setNewPrEmail("");
    if (newPrEmailRef.current) newPrEmailRef.current.value = "";
    const p4 = localSvcs.find((s: any) => s.key === "payroll");
    if (p4?.csId) fetch("/api/clients",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({csId:p4.csId,payEmails:upd})}).catch(()=>{});
  };
  // ── STX line item focus ref for auto-scroll ──
  useEffect(() => {
    if (stxLineItemFocus && open) {
      setTimeout(() => {
        const el = document.querySelector(`[data-stx-name="${stxLineItemFocus}"]`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 400);
    }
  }, [stxLineItemFocus, open]);

  // ── Comment state ──
  const [activeCommentSvc, setActiveCommentSvc] = useState<string | null>(null);
  const [activeCommentMonth, setActiveCommentMonth] = useState<number>(-1);
  const [commentText, setCommentText] = useState("");

  // ── Client-level notes state ──
  const [notesMonth, setNotesMonth] = useState(new Date().getMonth());
  const [notesText, setNotesText] = useState("");
  const [noteType, setNoteType] = useState("others");

  // ── Sales tax line items state ──
  const stxSvcInit = client.services.find((s: any) => s.key === "sales_tax");
  const [stxLineItems, setStxLineItems] = useState<any[]>(stxSvcInit?.salesTaxLineItems || []);
  const [addingStx, setAddingStx] = useState(false);
  const [newStxName, setNewStxName] = useState("");
  const [newStxRt, setNewStxRt] = useState("");
  const [newStxTaxId, setNewStxTaxId] = useState("");
  const [newStxBank, setNewStxBank] = useState("");
  const [newStxRouting, setNewStxRouting] = useState("");
  const [newStxAccount, setNewStxAccount] = useState("");
  const [newStxFreq, setNewStxFreq] = useState("Monthly");
  const [newStxAssigned, setNewStxAssigned] = useState("");

  // ── Sales tax line item editing state (clients tab inline edit) ──
  const [editingStxIdx, setEditingStxIdx] = useState<number>(-1);
  const [editStxName, setEditStxName] = useState("");
  const [editStxRt, setEditStxRt] = useState("");
  const [editStxTaxId, setEditStxTaxId] = useState("");
  const [editStxBank, setEditStxBank] = useState("");
  const [editStxRouting, setEditStxRouting] = useState("");
  const [editStxAccount, setEditStxAccount] = useState("");
  const [editStxFreq, setEditStxFreq] = useState("Monthly");
  const [editStxAssigned, setEditStxAssigned] = useState("");
  const [editStxNotes, setEditStxNotes] = useState("");

  // ── Payroll details state ──
  const prSvcInit = client.services.find((s: any) => s.key === "payroll");
  const [prPaydate, setPrPaydate] = useState(prSvcInit?.paydate || "");
  const [prStartDate, setPrStartDate] = useState(prSvcInit?.payStartDate || "");
  const [prPin, setPrPin] = useState(prSvcInit?.payrollPassword || "");
  const [showPrPin, setShowPrPin] = useState(false);
  const [prEftps, setPrEftps] = useState(prSvcInit?.eftps || "");
  const [showPrEftps, setShowPrEftps] = useState(false);
  const prPinRef = useRef<HTMLInputElement>(null);
  const prEftpsRef = useRef<HTMLInputElement>(null);
  const [prEmails, setPrEmails] = useState<string[]>(prSvcInit?.payEmails || []);
  const [newPrEmail, setNewPrEmail] = useState("");
  // New payroll fields
  const [prPeriodFreq, setPrPeriodFreq] = useState(prSvcInit?.frequency || prSvcInit?.payPeriodFrequency || "");
  const [prReportingMethod, setPrReportingMethod] = useState(prSvcInit?.reportingMethod || "");
  const [prPayrollCategory, setPrPayrollCategory] = useState(prSvcInit?.payrollCategory || "");
  const [prQbLicense, setPrQbLicense] = useState(prSvcInit?.qbLicense || "");
  const [prReportingNotes, setPrReportingNotes] = useState(prSvcInit?.reportingNotes || "");
  const reportingRef = useRef<HTMLTextAreaElement>(null);
  // ── Client detail refs (uncontrolled — avoids mobile keyboard dismissal) ──
  const newPrEmailRef = useRef<HTMLInputElement>(null);
  const eEmailRef = useRef<HTMLInputElement>(null);
  const eAddEmailRef = useRef<HTMLInputElement>(null);
  const ePhoneRef = useRef<HTMLInputElement>(null);
  const eAddPhoneRef = useRef<HTMLInputElement>(null);
  const eAddressRef = useRef<HTMLInputElement>(null);
  const eCityRef = useRef<HTMLInputElement>(null);
  const eStateRef = useRef<HTMLInputElement>(null);
  const eZipRef = useRef<HTMLInputElement>(null);
  const eNotesRef = useRef<HTMLTextAreaElement>(null);
  // ── STX line-item form refs (uncontrolled) ──
  const stxNameRef = useRef<HTMLInputElement>(null);
  const stxRtRef = useRef<HTMLInputElement>(null);
  const stxTaxIdRef = useRef<HTMLInputElement>(null);
  const stxBankRef = useRef<HTMLInputElement>(null);
  const stxRoutingRef = useRef<HTMLInputElement>(null);
  const stxAccountRef = useRef<HTMLInputElement>(null);

  // ── Pay Day options (all weekdays plus month-date patterns) ──
  const payDayOptions = PAY_DAY_OPTIONS;

  // ── Calculate next payroll start date based on cadence + pay day ──
  const calcPayrollStartDate = (cadence: string, payDay: string): string | null => {
    return calculatePayrollStartDate(cadence, normalizePayDay(payDay));
  };

  // ── Notes pagination ──
  const [notePage, setNotePage] = useState(0);

  // ── Tax returns state ──
  const trSvcInit = client.services.find((s: any) => s.key === "tax_returns");
  const rendSvcInit = client.services.find((s: any) => s.key === "annual_reports") || client.services.find((s: any) => s.key === "renditions");
  const [filingState, setFilingState] = useState(trSvcInit?.filingState || "");
  const [filingMonth, setFilingMonth] = useState(trSvcInit?.filingMonth ? String(trSvcInit.filingMonth) : "");
  const [filingType, setFilingType] = useState(trSvcInit?.filingType || "");
  const [stateRenewal, setStateRenewal] = useState(rendSvcInit?.stateRenewal || false);
  const [renewalState, setRenewalState] = useState(rendSvcInit?.renewalState || "TX");
  const [renewalDueMonth, setRenewalDueMonth] = useState(rendSvcInit?.renewalDueMonth || "");
  const [renewalDueDay, setRenewalDueDay] = useState(rendSvcInit?.renewalDueDay || "");
  const [renewalIds, setRenewalIds] = useState(rendSvcInit?.renewalIdentifiers || "");

  // ── State renewal line items (multi-state, Annual Reports tab) ──
  const [renewalItems, setRenewalItems] = useState<any[]>(rendSvcInit?.stateRenewalItems || []);

  // ── Per-renewal-item note state ──
  const [renewalNoteText, setRenewalNoteText] = useState<Record<number, string>>({});
  const [renewalNoteMonth, setRenewalNoteMonth] = useState<Record<number, number>>({});

  function addRenewalItemNote(itemIdx: number) {
    const text = (renewalNoteText[itemIdx] || "").trim();
    if (!text) return;
    const month = renewalNoteMonth[itemIdx] ?? new Date().getMonth();
    const comment: CommentEntry = {
      id: `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      month,
      text,
      author: getAuthorName(),
      createdAt: new Date().toISOString(),
    };
    const items = renewalItems.map((it: any, i: number) =>
      i === itemIdx ? { ...it, comments: [...(it.comments || []), comment] } : it
    );
    setRenewalItems(items);
    const renewalSvc = findRenewalService(localSvcs);
    const newSvcs = localSvcs.map((s: any) =>
      s.key === (renewalSvc?.key || "annual_reports") ? { ...s, stateRenewalItems: items } : s
    );
    setLocalSvcs(newSvcs);
    setRenewalNoteText((prev: any) => ({ ...prev, [itemIdx]: "" }));
    const rendSvc = findRenewalService(newSvcs);
    if (rendSvc?.csId) {
      fetch("/api/clients", { method: "PATCH", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ csId: rendSvc.csId, stateRenewalItems: items }) }).catch(() => {});
    }
  }

  function deleteRenewalItemComment(itemIdx: number, commentId: string) {
    const items = renewalItems.map((it: any, i: number) =>
      i === itemIdx ? { ...it, comments: (it.comments || []).filter((c: any) => c.id !== commentId) } : it
    );
    setRenewalItems(items);
    const renewalSvc = findRenewalService(localSvcs);
    const newSvcs = localSvcs.map((s: any) =>
      s.key === (renewalSvc?.key || "annual_reports") ? { ...s, stateRenewalItems: items } : s
    );
    setLocalSvcs(newSvcs);
    const rendSvc = findRenewalService(newSvcs);
    if (rendSvc?.csId) {
      fetch("/api/clients", { method: "PATCH", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ csId: rendSvc.csId, stateRenewalItems: items }) }).catch(() => {});
    }
  }
  const [addingRenewal, setAddingRenewal] = useState(false);
  const renewalAddStateRef = useRef<HTMLSelectElement>(null);
  const renewalAddMonthRef = useRef<HTMLSelectElement>(null);
  const renewalAddDayRef = useRef<HTMLInputElement>(null);
  const renewalAddIdsRef = useRef<HTMLInputElement>(null);
  const renewalAddAssignedRef = useRef<HTMLSelectElement>(null);
  const [editingRenewalIdx, setEditingRenewalIdx] = useState<number | null>(null);

  // ── State: being edited → show full record ──
  const [isActive, setIsActive] = useState(client.active !== false);
  const toggleActive = async () => {
    if (!canEditClientData) return;
    const newVal = !isActive;
    setIsActive(newVal);
    try {
      await fetch("/api/clients", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: client.id, active: newVal, authorName: getAuthorName() }),
      });
    } catch (e) { console.error("Failed to toggle active:", e); }
  };

  // ── 1099s count state ──
  const [t9Counts, setT9Counts] = useState<number[]>(Array(12).fill(0));

  // ── Profiles for assignee dropdown ──
  const [profiles, setProfiles] = useState<{id: string; name: string}[]>([]);
  useEffect(() => {
    fetch("/api/profile-directory").then(r => r.json()).then(data => {
      if (Array.isArray(data)) setProfiles(data
        .filter((u: any) => u.status === "Active")
        .filter((u: any) => !["Max Matronin", "Staff Test"].includes(u.name))
        .map((u: any) => ({ id: u.id, name: u.name })));
    }).catch(() => {});
  }, []);

  // ── Helper: extract first name (handles "Last, First" and "First Last" formats) ──
  const firstName = (fullName: string) => fullName.includes(",")
    ? fullName.split(",")[1].trim()
    : fullName.split(" ")[0];

  useEffect(() => {
    const svc = client.services.find((s: any) => s.key === "1099s");
    if (svc?.csId) {
      const year = new Date().getFullYear();
      fetch(`/api/period-counts?client_service_id=${svc.csId}&year=${year}`)
        .then(res => res.json())
        .then(data => {
          if (data.counts && Array.isArray(data.counts)) {
            const counts = Array(12).fill(0);
            for (const c of data.counts) {
              const parts = c.period?.split("-");
              if (parts && parts.length >= 2) {
                const monthIdx = parseInt(parts[1]) - 1;
                if (monthIdx >= 0 && monthIdx < 12) {
                  counts[monthIdx] = Math.max(0, c.processed || 0);
                }
              }
            }
            setT9Counts(counts);
          }
        })
        .catch(() => {});
    }
  }, [client]);
  useEffect(() => {
    // Sync local state when switching clients OR when underlying data changes
    const currentId = clientRef.current;
    const stxItemsChanged = (() => {
      if (currentId !== client.id) return true;
      const newStx = client.services.find((s: any) => s.key === "sales_tax");
      const oldStx = localSvcs.find((s: any) => s.key === "sales_tax");
      return JSON.stringify(newStx?.salesTaxLineItems) !== JSON.stringify(oldStx?.salesTaxLineItems);
    })();
    if (currentId === client.id && !stxItemsChanged) return;
    clientRef.current = client.id;
    clientIdRef.current = client.id;
    setLocalSvcs(client.services);
    setEditing(false);
    // Initialize per-service assignees for edit view
    const assigneeMap: Record<string, string> = {};
    client.services.forEach((s: any) => {
      assigneeMap[s.key] = s.assignedTo || s.processor || "Unassigned";
    });
    setESvcAssignees(assigneeMap);
    // Load existing sales tax line items
    const stxSvc = client.services.find((s: any) => s.key === "sales_tax");
    const items = stxSvc?.salesTaxLineItems || [];
    setStxLineItems(items);
    // Auto-select the month with the earliest comment for the active module
    if (moduleKey) {
      // Map virtual module keys to real service keys
      const resolvedKey = moduleKey === "annual_reports" ? "annual_reports" : moduleKey;
      const svc = client.services.find((s: any) => s.key === resolvedKey);
      const comments = svc?.comments || [];
      if (comments.length > 0) {
        const months = [...new Set(comments.map((c: any) => c.month))].sort((a: number, b: number) => a - b);
        setNotesMonth(months[0]);
      }
    }
    // Initialize payroll fields
    const prSvc = client.services.find((s: any) => s.key === "payroll");
    setPrPaydate(normalizePayDay(prSvc?.paydate || ""));
    setPrStartDate(prSvc?.payStartDate || "");
    setPrPin(prSvc?.payrollPassword || "");
    setPrEftps(prSvc?.eftps || "");
    setPrEmails(prSvc?.payEmails || []);
    setPrPeriodFreq(prSvc?.frequency || prSvc?.payPeriodFrequency || "");
    // Auto-fill start date if cadence + pay day are set but start date is not
    const effectiveFreq = prSvc?.frequency || prSvc?.payPeriodFrequency || "";
    const effectivePayday = prSvc?.paydate || "";
    if (effectiveFreq && effectivePayday && !prSvc?.payStartDate) {
      const newStart = calcPayrollStartDate(effectiveFreq, effectivePayday);
      if (newStart) {
        setPrStartDate(newStart);
        if (prSvc?.csId) fetch("/api/clients",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({csId:prSvc.csId,payStartDate:newStart})}).catch(()=>{});
      }
    }
    setPrReportingMethod(prSvc?.reportingMethod || "");
    setPrPayrollCategory(prSvc?.payrollCategory || "");
    setPrQbLicense(prSvc?.qbLicense || "");
    setPrReportingNotes(prSvc?.reportingNotes || "");
    // Sync uncontrolled input refs when switching clients
    if (prPinRef.current) prPinRef.current.value = prSvc?.payrollPassword || "";
    if (prEftpsRef.current) prEftpsRef.current.value = prSvc?.eftps || "";
    if (reportingRef.current) reportingRef.current.value = prSvc?.reportingNotes || "";
    // Sync client detail uncontrolled inputs
    if (eEmailRef.current) eEmailRef.current.value = (client.emails || [""])[0] || "";
    if (eAddEmailRef.current) eAddEmailRef.current.value = (client.emails || [])[1] || "";
    if (ePhoneRef.current) ePhoneRef.current.value = (client.phones || [""])[0] || "";
    if (eAddPhoneRef.current) eAddPhoneRef.current.value = (client.phones || [])[1] || "";
    if (eAddressRef.current) eAddressRef.current.value = client.address || "";
    if (eCityRef.current) eCityRef.current.value = client.city || "";
    if (eStateRef.current) eStateRef.current.value = client.state || "";
    if (eZipRef.current) eZipRef.current.value = (client as any).zip || "";
    if (eEinRef.current) eEinRef.current.value = client.ein || "";
    if (eNotesRef.current) eNotesRef.current.value = client.notes || "";
    setENotes(client.notes || "");
    // Reset notes pagination
    setNotePage(0);
    // Initialize tax returns fields
    const trSvc = client.services.find((s: any) => s.key === "tax_returns");
    setFilingState(trSvc?.filingState || "");
    setFilingMonth(trSvc?.filingMonth ? String(trSvc.filingMonth) : "");
    setFilingType(trSvc?.filingType || "");
    // Initialize state renewal from Annual Reports, with legacy Renditions fallback
    const rendSvc = findRenewalService(client.services);
    setStateRenewal(rendSvc?.stateRenewal || false);
    setRenewalState(rendSvc?.renewalState || "TX");
    setRenewalDueMonth(rendSvc?.renewalDueMonth || "");
    setRenewalDueDay(rendSvc?.renewalDueDay || "");
    setRenewalIds(rendSvc?.renewalIdentifiers || "");
    setRenewalItems(rendSvc?.stateRenewalItems || []);
    // Auto-open the add form when sales tax is enabled with no line items
    if (stxSvc?.enabled && items.length === 0 && !editing) {
      setAddingStx(true);
    }
  }, [client]);

  // ── Edit view state ──
  const [eName, setEName] = useState(client.name);
  const [eType, setEType] = useState(client.type);
  const [eGroup, setEGroup] = useState(client.group);
  const [eContact, setEContact] = useState(client.contact || "");
  const [eEmail, setEEmail] = useState((client.emails || [""])[0] || "");
  const [eAddEmail, setEAddEmail] = useState((client.emails || [])[1] || "");
  const [ePhone, setEPhone] = useState((client.phones || [""])[0] || "");
  const [eAddPhone, setEAddPhone] = useState((client.phones || [])[1] || "");
  const [eAddress, setEAddress] = useState(client.address);
  const [eCity, setECity] = useState(client.city);
  const [eState, setEState] = useState(client.state);
  const [eZip, setEZip] = useState((client as any).zip || "");
  const [eEin, setEEin] = useState(client.ein || "");
  const eEinRef = useRef<HTMLInputElement>(null);
  const [eNotes, setENotes] = useState(client.notes || "");
  const [eAssigned, setEAssigned] = useState(client.assignedStaff || "Unassigned");

  // ── Helper: sync renewal items via PATCH (or PUT if service row doesn't exist yet) ──
  const syncRenewalItems = useCallback(async (items: any[]) => {
    const rendSvc = findRenewalService(localSvcs);
    const csId = rendSvc?.csId;
    if (csId) {
      try {
        const res = await fetch("/api/clients", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csId, stateRenewalItems: items }) });
        if (!res.ok) console.warn("syncRenewalItems PATCH failed:", res.status, await res.text());
      } catch (e: any) {
        console.error("syncRenewalItems PATCH error:", e.message);
      }
    } else {
      // No DB row yet - go through PUT to create service + items together
      console.warn("syncRenewalItems: no csId, falling back to PUT");
      const targetKey = rendSvc?.key || "annual_reports";
      const updated = localSvcs.map((s: any) => s.key === targetKey ? { ...s, stateRenewalItems: items, stateRenewal: true, enabled: true } : s);
      autoSave({ ...client, services: updated } as Client);
    }
  }, [localSvcs, client, autoSave]);
  const [eSvcAssignees, setESvcAssignees] = useState<Record<string, string>>({});
  const [eFinMonth, setEFinMonth] = useState(() => {
    const svc = client.services.find((s: any) => s.key === "financials");
    return svc?.financialsMonth ?? 0;
  });

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // Blurring synchronously runs the active field's autosave handler so
        // flushSave receives the latest ref value before the slideover closes.
        (document.activeElement as HTMLElement | null)?.blur();
        flushSave();
        onClose();
      }
    }
    if (open) { document.addEventListener("keydown", onKey); document.body.style.overflow = "hidden"; }
    else { setConfirmDelete(false); }
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open, flushSave, onClose]);

  // ── Preserve scroll position across re-renders ──
  useLayoutEffect(() => {
    if (bodyRef.current && scrollPosRef.current > 0) {
      bodyRef.current.scrollTop = scrollPosRef.current;
    }
  });
  const saveScroll = () => {
    if (bodyRef.current) scrollPosRef.current = bodyRef.current.scrollTop;
  };

  if (!open) return null;

  const c = client;
  const typeBadge = c.type === "Business"
    ? { bg: "var(--ink)", fg: "#fff" }
    : { bg: "#dfe7e6", fg: "var(--teal-ink)" };

  // Unique assignees
  const assignees = [...new Set(
    localSvcs.filter((s: any) => s.enabled).map((s: any) => s.assignedTo || s.processor).filter(Boolean)
  )];

  // ── Helpers ──
  function getAuthorName(): string {
    if (currentUser) return currentUser;
    if (typeof document !== "undefined") {
      const m = document.cookie.match(/(?:^|;\s*)tap_demo_email=([^;]*)/);
      if (m?.[1]) return decodeURIComponent(m[1]);
    }
    return "You";
  }

  function getServiceComments(svcKey: string, monthIdx: number): CommentEntry[] {
    if ((moduleKey === "sales_tax" && svcKey === "sales_tax") ||
        (moduleKey === "annual_reports" && svcKey === "annual_reports")) return [];
    const svc = localSvcs.find((s: any) => s.key === svcKey);
    // Merge service-level comments with per-line-item comments (STX)
    const svcCmts = (svc?.comments || []);
    const lineItemCmts = svcKey === "sales_tax" && svc?.salesTaxLineItems
      ? svc.salesTaxLineItems.flatMap((item: any, idx: number) => 
          (item.comments || []).map((c: any) => ({ ...c, _stxIdx: idx }))
        )
      : [];
    return [...svcCmts, ...lineItemCmts].filter((cm: CommentEntry) => cm.month === monthIdx);
  }

  function hasComment(svcKey: string, monthIdx: number): boolean {
    return getServiceComments(svcKey, monthIdx).length > 0;
  }

  function addComment(svcKey: string, monthIdx: number, text: string) {
    if (!text.trim()) return;
    const comment: CommentEntry = {
      id: `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      month: monthIdx,
      text: text.trim(),
      author: getAuthorName(),
      createdAt: new Date().toISOString(),
    };
    const updated = localSvcs.map((s: any) => {
      if (s.key === svcKey) {
        // For STX: write comment to the focused line item if one is selected
        if (svcKey === "sales_tax" && stxLineItemFocus && s.salesTaxLineItems?.length) {
          const stxIdx = s.salesTaxLineItems.findIndex((item: any) => 
            (item.serviceName || item.rt_number || "") === stxLineItemFocus
          );
          if (stxIdx >= 0) {
            const items = [...s.salesTaxLineItems];
            items[stxIdx] = { ...items[stxIdx], comments: [...(items[stxIdx].comments || []), comment] };
            return { ...s, salesTaxLineItems: items };
          }
        }
        // Default: service-level comments
        const existing = s.comments || [];
        return { ...s, comments: [...existing, comment] };
      }
      return s;
    });
    setLocalSvcs(updated);
    // Also sync stxLineItems state
    if (svcKey === "sales_tax") {
      const stxSvc = updated.find((s: any) => s.key === "sales_tax");
      if (stxSvc?.salesTaxLineItems) setStxLineItems(stxSvc.salesTaxLineItems);
    }
    setCommentText("");
    setActiveCommentMonth(-1);
    setActiveCommentSvc(null);
    // Persist
    if (svcKey === "sales_tax" && stxLineItemFocus) {
      const stxSvc = updated.find((s: any) => s.key === "sales_tax");
      if (stxSvc?.csId) {
        fetch("/api/clients", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csId: stxSvc.csId, salesTaxLineItems: stxSvc.salesTaxLineItems }),
        }).catch(() => {});
      }
    } else {
      autoSave({ ...client, services: updated });
    }
  }

  function deleteComment(svcKey: string, commentId: string) {
    const updated = localSvcs.map((s: any) => {
      if (s.key === svcKey) {
        // Check per-line-item comments first (STX)
        if (svcKey === "sales_tax" && s.salesTaxLineItems?.length) {
          const items = s.salesTaxLineItems.map((item: any) => ({
            ...item,
            comments: (item.comments || []).filter((cm: CommentEntry) => cm.id !== commentId),
          }));
          return { ...s, salesTaxLineItems: items };
        }
        return { ...s, comments: (s.comments || []).filter((cm: CommentEntry) => cm.id !== commentId) };
      }
      return s;
    });
    setLocalSvcs(updated);
    // Also sync stxLineItems state
    if (svcKey === "sales_tax") {
      const stxSvc = updated.find((s: any) => s.key === "sales_tax");
      if (stxSvc?.salesTaxLineItems) setStxLineItems(stxSvc.salesTaxLineItems);
    }
    const svc = updated.find((s: any) => s.key === svcKey);
    // Count from both sources
    const svcCmts = (svc?.comments || []).length;
    const lineItemCmts = svcKey === "sales_tax" && svc?.salesTaxLineItems
      ? svc.salesTaxLineItems.reduce((sum: number, item: any) => sum + (item.comments?.length || 0), 0)
      : 0;
    const remaining = svcCmts + lineItemCmts;
    if (notePage > 0 && notePage * 3 >= remaining) {
      setNotePage(Math.max(0, Math.floor((remaining - 1) / 3)));
    }
    // Persist STX via PATCH, everything else via PUT
    if (svcKey === "sales_tax") {
      const stxSvc = updated.find((s: any) => s.key === "sales_tax");
      if (stxSvc?.csId) {
        fetch("/api/clients", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csId: stxSvc.csId, salesTaxLineItems: stxSvc.salesTaxLineItems }),
        }).catch(() => {});
      }
    } else {
      autoSave({ ...client, services: updated });
    }
  }

  // ── Client-level notes helpers ──
  function getAllServiceComments(): CommentEntry[] {
    const all: CommentEntry[] = [];
    for (const svc of localSvcs) {
      if (svc.comments && Array.isArray(svc.comments)) {
        for (const cm of svc.comments) {
          all.push({ ...cm, _svcKey: svc.key });
        }
      }
      // Also collect per-line-item comments from STX
      if (svc.key === "sales_tax" && svc.salesTaxLineItems) {
        for (let idx = 0; idx < svc.salesTaxLineItems.length; idx++) {
          const item = svc.salesTaxLineItems[idx];
          if (item.comments && Array.isArray(item.comments)) {
            for (const cm of item.comments) {
              all.push({ ...cm, _svcKey: svc.key, _stxIdx: idx });
            }
          }
        }
      }
    }
    return all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  function handleAddNote() {
    if (!notesText.trim()) return;
    const firstEnabledSvc = localSvcs.find((s: any) => s.enabled);
    if (!firstEnabledSvc) return;
    const prefix = noteType !== "others" ? `[${noteType}] ` : "";
    const comment: CommentEntry = {
      id: `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      month: notesMonth,
      text: prefix + notesText.trim(),
      author: getAuthorName(),
      createdAt: new Date().toISOString(),
    };
    const updated = localSvcs.map((s: any) => {
      if (s.key === firstEnabledSvc.key) {
        const existing = s.comments || [];
        return { ...s, comments: [...existing, comment] };
      }
      return s;
    });
    setLocalSvcs(updated);
    setNotesText("");
    setNoteType("others");
    autoSave({ ...client, services: updated });
  }

  function deleteNote(commentId: string) {
    const updated = localSvcs.map((s: any) => ({
      ...s,
      comments: (s.comments || []).filter((cm: CommentEntry) => cm.id !== commentId),
    }));
    setLocalSvcs(updated);
    autoSave({ ...client, services: updated });
  }

  function toggleSvc(key: string) {
    setLocalSvcs(prev => {
      const updated = prev.map((s: any) =>
        s.key === key ? { ...s, enabled: !s.enabled, months: s.enabled ? Array(12).fill("lock") : s.months } : s
      );
      if (key === "sales_tax") {
        const wasOff = !prev.find(s => s.key === key)?.enabled;
        if (wasOff && (!stxLineItems || stxLineItems.length === 0)) {
          setAddingStx(true);
        }
      }
      autoSave({ ...client, services: updated });
      return updated;
    });
  }

  function saveServiceField(key: string, field: string, value: any) {
    const updated = localSvcs.map((s: any) =>
      s.key === key ? { ...s, [field]: value } : s
    );
    setLocalSvcs(updated);
    autoSave({ ...c, services: updated } as Client);
    // Also call PATCH for immediate persistence of individual field changes
    const svc = localSvcs.find((s: any) => s.key === key);
    if (!svc?.csId || svc.csId === "") {
      // No DB row yet — enable it and fire PUT immediately to create it
      const enabled = updated.map((s: any) => s.key === key ? { ...s, enabled: true } : s);
      fetch("/api/clients", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...c, services: enabled }),
      })
        .then(async response => {
          if (!response.ok) throw new Error(`service creation failed (${response.status})`);
          const payload = await response.json();
          const created = payload.results?.find((result: any) => result.key === key && result.csId);
          if (created?.csId) {
            setLocalSvcs(prev => prev.map((service: any) =>
              service.key === key ? { ...service, enabled: true, csId: created.csId } : service
            ));
          }
        })
        .catch((error: any) => console.warn("saveServiceField PUT error:", error.message));
    }
    if (svc?.csId && svc.csId !== "") {
      fetch("/api/clients", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csId: svc.csId, [field]: value }),
      }).then(r => { if (!r.ok) console.warn("saveServiceField PATCH failed:", r.status, field); }).catch((e: any) => console.warn("saveServiceField PATCH error:", e.message, field));
    }
  }

  function freqLabel(key: string, svc: any) {
    if (!svc.enabled) return "off";
    if (moduleKey && key !== moduleKey) return "";
    if (key === "financials") return (svc.frequency || "Monthly") + " · in Financials list";
    if (key === "payroll") return (svc.frequency || "Bi-Weekly A") + " · " + (svc.processor || "-");
    if (key === "sales_tax") return (svc.frequency || "Monthly") + " · in Sales Tax list";
    if (key === "tax_returns") return svc.frequency || "Business";
    if (key === "1099s") return "in 1099 worklist";
    if (key === "renditions") return "in renditions worklist";
    return "";
  }

  // ── Comment panel ──
  function CommentPanel({ svcKey, monthIdx }: { svcKey: string; monthIdx: number }) {
    const panelRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
      function onClick(e: MouseEvent) {
        if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
          setActiveCommentMonth(-1);
          setActiveCommentSvc(null);
        }
      }
      document.addEventListener("mousedown", onClick);
      return () => document.removeEventListener("mousedown", onClick);
    }, []);

    const comments = getServiceComments(svcKey, monthIdx);

    return (
      <div ref={panelRef} className="comment-panel" style={{
        background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10,
        padding: "10px 12px", marginTop: 6, boxShadow: "0 4px 16px rgba(0,0,0,.08)",
        fontSize: 12, maxWidth: 260,
      }}>
        <div style={{ fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginBottom: 8 }}>
          Comments — {MONTHS[monthIdx]}
        </div>

        {comments.length > 0 && (
          <div style={{ marginBottom: 8, maxHeight: 150, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
            {comments.map((cm) => (
              <div key={cm.id} style={{ background: "var(--paper)", borderRadius: 7, padding: "6px 8px", position: "relative" }}>
                <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 3 }}>
                  <b>{cm.author}</b> · {new Date(cm.createdAt).toLocaleString()}
                </div>
                <div style={{ fontSize: 12, color: "var(--ink)", lineHeight: 1.4 }}>{cm.text}</div>
                <button
                  onClick={() => deleteComment(svcKey, cm.id)}
                  style={{ all: "unset", cursor: "pointer", position: "absolute", top: 4, right: 6, color: "var(--red)", fontSize: 11, lineHeight: 1 }}
                  title="Delete comment"
                >×</button>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 6 }}>
          <input
            style={{ flex: 1, padding: "5px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 12, background: "var(--paper)" }}
            value={commentText}
            onChange={e => setCommentText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addComment(svcKey, monthIdx, commentText); } }}
            placeholder="Add a comment…"
            autoFocus
          />
          <button
            onClick={() => addComment(svcKey, monthIdx, commentText)}
            style={{ all: "unset", cursor: "pointer", background: "var(--teal)", color: "#fff", padding: "5px 10px", borderRadius: 7, fontWeight: 600, fontSize: 12 }}
          >Send</button>
        </div>
      </div>
    );
  }

  // ── Month tracking ──
  function monthCells(svcKey: string) {
    const svc = localSvcs.find((s: any) => s.key === svcKey);
    if (!svc?.enabled) return null;
    const stages = svc.months || [];
    const now = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const year = currentYear;
    const isTaxReturns = svcKey === "tax_returns";

    function toStageKey(ms: string): string {
      switch (ms) {
        case "lock": return "";
        case "in_progress": return "ip";
        case "waiting": return "wc";
        case "billed": return "pp";
        case "delayed": return "dl";
        case "done": return "dn";
        case "na": return "na";
        default: return ms;
      }
    }
    function toMonthStatus(sk: string): string {
      switch (sk) {
        case "": return "lock";
        case "ip": return "in_progress";
        case "wc": return "waiting";
        case "pp": return "billed";
        case "dl": return "delayed";
        case "dn": return "done";
        case "na": return "na";
        default: return sk;
      }
    }

    const STAGE_CYCLE = ["", "ip", "wc", "pp", "dl", "dn", "na"];

    function handleNextStage(svcKey: string, monthIdx: number) {
      if (!moduleKey) return; // read-only from Clients tab
      if (svcKey === "sales_tax") return; // STX statuses managed from worklist, not slideover
      const svc = localSvcs.find((s: any) => s.key === svcKey);
      const currentStage = toStageKey((svc?.months || [])[monthIdx] || "");
      const idx = STAGE_CYCLE.indexOf(currentStage);
      const nextStage = STAGE_CYCLE[(idx + 1) % STAGE_CYCLE.length];
      const ms = toMonthStatus(nextStage);
      const updated = localSvcs.map((s: any) =>
        s.key === svcKey
          ? { ...s, months: s.months.map((m: string, i: number) => i === monthIdx ? ms : m) }
          : s
      );
      setLocalSvcs(updated);
      if (onStageChange) {
        onStageChange(client.id, svcKey, monthIdx, nextStage);
      }
    }

    return (
      <div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {MONTHS.map((mo, i) => {
            // ── 1099s: count-based cells ──
            if (svcKey === "1099s") {
              const n = t9Counts[i] || 0;
              const cmt = hasComment(svcKey, i);
              return (
                <div key={mo} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>{mo}</div>
                  <div
                    onClick={() => {
                      if (!moduleKey) return;
                      const newCounts = [...t9Counts];
                      newCounts[i] = (newCounts[i] || 0) + 1;
                      setT9Counts(newCounts);
                      const svc = localSvcs.find((s: any) => s.key === "1099s");
                      if (svc?.csId) {
                        const period = `${year}-${String(i + 1).padStart(2, "0")}`;
                        fetch("/api/period-counts", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ client_service_id: svc.csId, period, processed: newCounts[i] }),
                        }).catch(() => {});
                      }
                    }}
                    onContextMenu={(e) => {
                      if (!moduleKey) return;
                      e.preventDefault();
                      const newCounts = [...t9Counts];
                      newCounts[i] = Math.max(0, (newCounts[i] || 0) - 1);
                      setT9Counts(newCounts);
                      const svc = localSvcs.find((s: any) => s.key === "1099s");
                      if (svc?.csId) {
                        const period = `${year}-${String(i + 1).padStart(2, "0")}`;
                        fetch("/api/period-counts", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ client_service_id: svc.csId, period, processed: newCounts[i] }),
                        }).catch(() => {});
                      }
                    }}
                    style={{
                      width: 30, height: 30, borderRadius: 8,
                      backgroundColor: n > 0 ? "var(--green-soft)" : "transparent",
                      color: n > 0 ? "var(--green)" : "var(--muted)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      margin: "0 auto", fontWeight: 700, fontSize: 13, userSelect: "none",
                      cursor: (!moduleKey) ? "default" : "pointer",
                      border: n > 0 ? "1px solid var(--green)" : "1px solid transparent",
                      position: "relative",
                    }}
                    title={`${mo}: ${n} processed${moduleKey ? " — click +1, right-click -1" : ""}`}
                  >
                    {n || "·"}
                    {cmt && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setActiveCommentSvc(svcKey); setActiveCommentMonth(i); setCommentText(""); }}
                        className="cdot"
                        style={{ all: "unset", cursor: "pointer", position: "absolute", top: 1, right: 1, width: 6, height: 6, borderRadius: "50%", background: "var(--blue)", boxShadow: "0 0 0 1.5px #fff", zIndex: 2 }}
                        title={`Comments for ${mo}`}
                      />
                    )}
                  </div>
                  {activeCommentSvc === svcKey && activeCommentMonth === i && (
                    <CommentPanel svcKey={svcKey} monthIdx={i} />
                  )}
                </div>
              );
            }

            // ── Default: status-based cells ──
            const stage = toStageKey(stages[i] || "");
            const style = STAGE_STYLES[stage] || STAGE_STYLES[""];
            const stageLabel = isTaxReturns && stage === "dn" ? "Filed" : style.label;
            const t = stage === "" ? "·" : stage === "ip" ? "•" : stage === "wc" ? "⏳" : stage === "pp" ? "✓" : stage === "dl" ? "!" : (stage === "dn" ? (isTaxReturns ? "📋" : "✓") : stage === "na" ? "–" : "");
            const hasDelayBorder = stage === "dl";
            const cmt = hasComment(svcKey, i);
            return (
              <div key={mo} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>{mo}</div>
                <div
                  onClick={svcKey === "sales_tax" ? undefined : () => handleNextStage(svcKey, i)}
                  style={{
                    width: 30, height: 30, borderRadius: 8,
                    border: `1px solid ${hasDelayBorder ? "var(--red)" : style.border}`,
                    background: stage === "na" ? `repeating-linear-gradient(45deg, ${style.bg} 0px, ${style.bg} 3px, #c0c4cc40 3px, #c0c4cc40 5px)` : style.bg,
                    color: style.fg,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    margin: "0 auto", fontWeight: 700, fontSize: 14, userSelect: "none",
                    cursor: (!moduleKey || svcKey === "sales_tax") ? "default" : "pointer",
                    boxShadow: hasDelayBorder ? "0 0 0 2px var(--red)" : "none",
                    position: "relative",
                  }}
                  title={`${mo} — ${hasDelayBorder ? "DELAYED · " : ""}${stageLabel}${moduleKey && svcKey !== "sales_tax" ? " — click to cycle" : ""}`}
                >
                  {t}
                  {cmt && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setActiveCommentSvc(svcKey); setActiveCommentMonth(i); setCommentText(""); }}
                      className="cdot"
                      style={{ all: "unset", cursor: "pointer", position: "absolute", top: 1, right: 1, width: 6, height: 6, borderRadius: "50%", background: "var(--blue)", boxShadow: "0 0 0 1.5px #fff", zIndex: 2 }}
                      title={`Comments for ${mo}`}
                    />
                  )}
                </div>
                {activeCommentSvc === svcKey && activeCommentMonth === i && (
                  <CommentPanel svcKey={svcKey} monthIdx={i} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Single service card (reusable) ──
  function SingleServiceCard({ svc }: { svc: any }) {
    const isPayroll = svc.key === "payroll";
    const isSalesTax = svc.key === "sales_tax";
    const isTaxReturns = svc.key === "tax_returns";
    const isFin = svc.key === "financials";
    const isT9 = svc.key === "1099s";
    const isRend = svc.key === "renditions";
    const isAnnualReports = svc.key === "annual_reports" || (svc.key === "renditions" && moduleKey === "annual_reports");
    const isRendOrAnnual = svc.key === "renditions" || svc.key === "annual_reports";
    const isUniversalRenditions = !moduleKey && svc.key === "renditions";

    return (
      <div style={{ marginBottom: 12, background: "var(--card)", border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
        {/* Toggle card row */}
        <div className="svc" style={{
          display: "flex", alignItems: "center", gap: 12, padding: "12px 13px",
        }}>
          <div className="si" style={{ width: 30, height: 30, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, background: svcBg(svc.key) }}>
            {svcIc(svc.key)}
          </div>
          <div className="st" style={{ flex: 1 }}>
            <div className="t" style={{ fontWeight: 600, fontSize: 14 }}>{svcLabel(svc.key)}</div>
            <div className="d" style={{ fontSize: 12, color: "var(--muted)" }}>{freqLabel(svc.key, svc)}</div>
            {!moduleKey && (
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                {svc.assignedTo || "Unassigned"}
                {isPayroll && svc.processor && <> · {svc.processor}</>}
                {isT9 && svc.expectedAnnual ? <> · {svc.expectedAnnual}/yr</> : null}
              </div>
            )}
          </div>
          <div
            className={`sw ${svc.enabled ? "on" : ""}`}
            onClick={() => {
              if (moduleKey) return;
              if (svc.key === "annual_reports") {
                // Toggle annual_reports as a real service
                const newEnabled = !svc.enabled;
                setLocalSvcs(prev => {
                  const updated = prev.map((s: any) =>
                    s.key === "annual_reports" ? { ...s, enabled: newEnabled, stateRenewal: newEnabled, months: s.enabled ? Array(12).fill("lock") : s.months } : s
                  );
                  // If enabling, copy current stateRenewalItems from renditions if annual_reports has none
                  if (newEnabled) {
                    const rend = updated.find((s: any) => s.key === "renditions");
                    const annual = updated.find((s: any) => s.key === "annual_reports");
                    if (rend && annual && !annual.stateRenewalItems?.length && rend.stateRenewalItems?.length) {
                      annual.stateRenewalItems = rend.stateRenewalItems;
                      annual.stateRenewal = true;
                    }
                  }
                  autoSave({ ...client, services: updated });
                  return updated;
                });
                return;
              }
              toggleSvc(svc.key);
            }}
            style={{
              width: 46, height: 27, borderRadius: 20,
              background: svc.enabled ? "var(--teal)" : "#d8d2c4",
              position: "relative", cursor: moduleKey ? "default" : "pointer", transition: ".16s", flex: "0 0 auto",
              opacity: moduleKey ? 0.6 : 1,
            }}
          >
            <div style={{
              position: "absolute", top: 3, left: svc.enabled ? 22 : 3, width: 21, height: 21,
              borderRadius: "50%", background: "#fff", transition: ".16s",
              boxShadow: "0 1px 3px rgba(0,0,0,.25)",
            }} />
          </div>
        </div>

        {/* Month tracking under card */}
        {svc.enabled && (
          <div style={{ padding: "6px 13px 12px", borderTop: "1px dashed var(--line)" }}>
            {isUniversalRenditions && (
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Assigned To</label>
                <select style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13, background: "var(--paper)" }}
                  value={svc.assignedTo || ""}
                  onChange={e => saveServiceField("renditions", "assignedTo", e.target.value)}
                >
                  <option value="">—</option>
                  {profiles.map((p: any) => <option key={p.id} value={p.name}>{firstName(p.name)}</option>)}
                </select>
              </div>
            )}
            {!isUniversalRenditions && (
              <>
            {/* Payroll: credentials section */}
            {isPayroll && svc.enabled && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ marginBottom: 6 }}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>EIN</label>
                  <input
                    ref={eEinRef}
                    defaultValue={eEin}
                    onBlur={e => {
                      setEEin(e.target.value);
                      autoSave({ ...c, ein: e.target.value } as Client);
                    }}
                    placeholder="XX-XXXXXXX"
                    style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13, boxSizing: "border-box", background: "var(--paper)", fontFamily: "var(--mono)" }}
                  />
                </div>
                {/* Assignee + Processor row */}
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
                  <div style={{ flex: "1 0 100px", minWidth: 100 }}>
                    <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Assigned To</label>
                    <select style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13, boxSizing: "border-box", background: "var(--paper)" }}
                      value={svc.assignedTo || svc.processor || ""}
                      onChange={e => saveServiceField("payroll", "assignedTo", e.target.value)}
                    >
                      <option value="">—</option>
                      {profiles.map((p: any) => <option key={p.id} value={p.name}>{firstName(p.name)}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: "1 0 100px", minWidth: 100 }}>
                    <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Processor</label>
                    <select style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13, boxSizing: "border-box", background: "var(--paper)" }}
                      value={svc.processor || ""}
                      onChange={e => saveServiceField("payroll", "processor", e.target.value)}
                    >
                      <option value="">—</option>
                      <option value="Quickbooks Desktop 24">Quickbooks Desktop 24</option>
                      <option value="Quickbooks Desktop">Quickbooks Desktop</option>
                      <option value="ADP">ADP</option>
                      <option value="QBO">QBO</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
                  <div style={{ flex: "1 0 100px", minWidth: 100 }}>
                    <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Pay date / day</label>
                    <select style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13, boxSizing: "border-box", background: "var(--paper)" }}
                      value={prPaydate}
                      onChange={e => {
                        const normalizedPayDay = normalizePayDay(e.target.value);
                        setPrPaydate(normalizedPayDay);
                        // Recalculate start date when pay day changes
                        const newStart = calcPayrollStartDate(prPeriodFreq, normalizedPayDay);
                        setLocalSvcs(prev => prev.map((s: any) => s.key === "payroll" ? { ...s, paydate: normalizedPayDay, ...(newStart ? { pay_start_date: newStart } : {}) } : s));
                        if (newStart) setPrStartDate(newStart);
                        const px = localSvcs.find((s: any) => s.key === "payroll");
                        if (px?.csId) fetch("/api/clients",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({csId:px.csId,paydate:normalizedPayDay,...(newStart?{pay_start_date:newStart}:{})})}).catch(()=>{});
                      }}>
                      <option value="">—</option>
                      {payDayOptions.map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: "1 0 100px", minWidth: 100 }}>
                    <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Start Date</label>
                    <input style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13, boxSizing: "border-box", background: "var(--paper)", color: "var(--ink)" }}
                      value={formatPayrollStartDate(prStartDate)} readOnly placeholder="mm/dd/yyyy" />
                  </div>
                  <div style={{ flex: "1 0 100px", minWidth: 100 }}>
                    <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Payroll PIN</label>
                    <div style={{ position: "relative" }}>
                      <input style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13, boxSizing: "border-box", background: "var(--paper)", paddingRight: 30 }}
                        type={showPrPin ? "text" : "password"} ref={prPinRef} defaultValue={prPin}
                        onBlur={e => { setPrPin(e.target.value); const p = localSvcs.find((s: any) => s.key === 'payroll'); if (p?.csId) fetch('/api/clients',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({csId:p.csId,payrollPassword:e.target.value})}).catch(()=>{}); }}
                        placeholder="EFT pin"
                      />
                      <button type="button" tabIndex={-1}
                        onClick={() => setShowPrPin(!showPrPin)}
                        style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 4, color: "var(--muted)", fontSize: 15, lineHeight: 1 }}
                      >
                        {showPrPin ? (
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        )}
                      </button>
                    </div>
                  </div>
                  <div style={{ flex: "1 0 100px", minWidth: 100 }}>
                    <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>EFTPS Password</label>
                    <div style={{ position: "relative" }}>
                      <input style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13, boxSizing: "border-box", background: "var(--paper)", paddingRight: 30 }}
                        type={showPrEftps ? "text" : "password"} ref={prEftpsRef} defaultValue={prEftps}
                        onBlur={e => { setPrEftps(e.target.value); const p = localSvcs.find((s: any) => s.key === 'payroll'); if (p?.csId) fetch('/api/clients',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({csId:p.csId,eftps:e.target.value})}).catch(()=>{}); }}
                        placeholder="EFTPS password"
                      />
                      <button type="button" tabIndex={-1}
                        onClick={() => setShowPrEftps(!showPrEftps)}
                        style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 4, color: "var(--muted)", fontSize: 15, lineHeight: 1 }}
                      >
                        {showPrEftps ? (
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
                {/* New payroll fields row */}
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
                  <div style={{ flex: "1 0 100px", minWidth: 100 }}>
                    <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Pay Period Freq</label>
                    <select style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13, boxSizing: "border-box", background: "var(--paper)" }}
                      value={prPeriodFreq}
                      onChange={e => {
                        const newFreq = e.target.value;
                        setPrPeriodFreq(newFreq);
                        // Recalculate start date based on new cadence + current pay day
                        const newStart = calcPayrollStartDate(newFreq, prPaydate);
                        const updated = localSvcs.map((s: any) => s.key === "payroll" ? { ...s, payPeriodFrequency: newFreq, frequency: newFreq, ...(newStart ? { pay_start_date: newStart } : {}) } : s);
                        setLocalSvcs(updated);
                        if (newStart) setPrStartDate(newStart);
                        autoSave({ ...c, services: updated } as Client);
                      }}
                    >
                      <option value="">—</option>
                    <option value="Weekly">Weekly</option>
                    <option value="Bi-Weekly A">Bi-Weekly A</option>
                    <option value="Bi-Weekly B">Bi-Weekly B</option>
                    <option value="Semi-Monthly">Semi-Monthly</option>
                    <option value="Monthly">Monthly</option>
                    <option value="Quarterly">Quarterly</option>
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: 6 }}>
                <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Notes</label>
                <textarea style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13, boxSizing: "border-box", background: "var(--paper)", minHeight: 50, resize: "vertical" }}
                  ref={reportingRef}
                  defaultValue={prReportingNotes}
                  onBlur={e => { setPrReportingNotes(e.target.value); const p = localSvcs.find((s: any) => s.key === 'payroll'); if (p?.csId) fetch('/api/clients',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({csId:p.csId,reportingNotes:e.target.value})}).catch(()=>{}); }}
                  placeholder="Add payroll notes..."
                />
              </div>
                {/* Payroll emails - tag list */}
                <div style={{ marginBottom: 6 }}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Contact emails</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
                    {prEmails.map((em, i) => (
                      <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "var(--blue-soft)", borderRadius: 6, padding: "2px 8px", fontSize: 12, fontWeight: 500 }}>
                        {em}
                        <button onClick={() => { const upd = prEmails.filter((_, j) => j !== i); setPrEmails(upd); setLocalSvcs(prev => prev.map((s: any) => s.key === "payroll" ? { ...s, payEmails: upd } : s)); const p2 = localSvcs.find((s: any) => s.key === "payroll"); if (p2?.csId) fetch("/api/clients",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({csId:p2.csId,payEmails:upd})}).catch(()=>{}); }}
                          style={{ all: "unset", cursor: "pointer", color: "var(--red)", fontSize: 12, lineHeight: 1 }}>×</button>
                      </span>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <input style={{ flex: 1, padding: "5px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 12, background: "#fff" }}
                      ref={newPrEmailRef}
                      defaultValue={newPrEmail}
                      onBlur={e => setNewPrEmail(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") addPrEmail(); }}
                      placeholder="Type email + Enter"
                    />
                    <button className="reveal"
                      onClick={addPrEmail}
                      style={{ all: "unset", cursor: "pointer", padding: "5px 10px", background: "var(--ink)", color: "#fff", borderRadius: 7, fontSize: 14, fontWeight: 700, lineHeight: 1 }}>+</button>
                  </div>
                </div>
              </div>
            )}

            {/* Financials: cadence + Assigned To */}
            {isFin && svc.enabled && (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                <div style={{ flex: "1 0 100px" }}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Cadence</label>
                  <select style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13, background: "var(--paper)" }}
                    value={svc.frequency || "Monthly"}
                    onChange={e => saveServiceField("financials", "frequency", e.target.value)}
                  >
                    <option value="Monthly">Monthly</option>
                    <option value="Quarterly">Quarterly</option>
                    <option value="Annual">Annual</option>
                    <option value="Semi-Monthly">Semi-Monthly</option>
                  </select>
                </div>
                <div style={{ flex: "1 0 100px", minWidth: 100 }}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Assigned To</label>
                  <select style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13, background: "var(--paper)" }}
                    value={svc.assignedTo || svc.processor || ""}
                    onChange={e => saveServiceField("financials", "assignedTo", e.target.value)}
                  >
                    <option value="">—</option>
                    {profiles.map((p: any) => <option key={p.id} value={p.name}>{firstName(p.name)}</option>)}
                  </select>
                </div>
              </div>
            )}

            {/* 1099s: expected annual + Assigned To */}
            {isT9 && svc.enabled && (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                <div style={{ flex: "1 0 100px" }}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Expected Annual</label>
                  <input style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13, background: "var(--paper)" }}
                    type="number" defaultValue={svc.expectedAnnual || 0}
 onBlur={e => { setLocalSvcs((prev: any) => prev.map((s: any) => s.key === "1099s" ? { ...s, expectedAnnual: Number(e.target.value) } : s)); if (svc?.csId) fetch("/api/clients",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({csId:svc.csId,expectedAnnual:Number(e.target.value)})}).catch(()=>{}); }}
                    placeholder="0"
                  />
                </div>
                <div style={{ flex: "1 0 100px", minWidth: 100 }}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Assigned To</label>
                  <select style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13, background: "var(--paper)" }}
                    value={svc.assignedTo || svc.processor || ""}
                    onChange={e => saveServiceField("1099s", "assignedTo", e.target.value)}
                  >
                    <option value="">—</option>
                    {profiles.map((p: any) => <option key={p.id} value={p.name}>{firstName(p.name)}</option>)}
                  </select>
                </div>
              </div>
            )}

            {/* Tax Returns: filing details + Assigned To */}
            {isTaxReturns && svc.enabled && (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                <div style={{ flex: "1 0 100px" }}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Filing state</label>
                  <select style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13, background: "var(--paper)" }}
                    value={filingState}
                    onChange={e => {
                      setFilingState(e.target.value);
                      saveServiceField("tax_returns", "filingState", e.target.value);
                    }}
                  >
                    <option value="">Select state…</option>
                    {US_STATES.map(st => <option key={st} value={st}>{st}</option>)}
                  </select>
                </div>
                <div style={{ flex: "1 0 100px" }}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Filing month</label>
                  <select style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13, background: "var(--paper)" }}
                    value={filingMonth}
                    onChange={e => {
                      setFilingMonth(e.target.value);
                      saveServiceField("tax_returns", "filingMonth", e.target.value);
                    }}
                  >
                    <option value="">Select month…</option>
                    {MONTH_NAMES.map((m, i) => <option key={i} value={String(i + 1)}>{m}</option>)}
                  </select>
                </div>
                <div style={{ flex: "1 0 100px" }}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Filing type</label>
                  <select style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13, background: "var(--paper)" }}
                    value={filingType}
                    onChange={e => {
                      setFilingType(e.target.value);
                      saveServiceField("tax_returns", "filingType", e.target.value);
                    }}
                  >
                    <option value="">Select type…</option>
                    {FILING_TYPES.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </div>
                <div style={{ flex: "1 0 100px", minWidth: 100 }}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Assigned To</label>
                  <select style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13, background: "var(--paper)" }}
                    value={svc.assignedTo || svc.processor || ""}
                    onChange={e => saveServiceField("tax_returns", "assignedTo", e.target.value)}
                  >
                    <option value="">—</option>
                    {profiles.map((p: any) => <option key={p.id} value={p.name}>{firstName(p.name)}</option>)}
                  </select>
                </div>
              </div>
            )}

            {/* State renewal items (per-item assigned) are handled in the module-specific annual_reports section below */}

            {/* Sales Tax: line items */}
            {isSalesTax && svc.enabled && (
              <div style={{ marginBottom: 10 }}>
                {/* Service Name */}
                <div style={{ marginBottom: 10, padding: "8px 10px", background: "var(--grey-soft,#f5f5f5)", borderRadius: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>Service Name</span>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", marginTop: 2 }}>{svc.serviceName || svc.label}</div>
                </div>
                <button
                  onClick={() => setAddingStx(!addingStx)}
                  style={{
                    all: "unset", cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "8px 12px", marginBottom: 8,
                    border: "1px dashed var(--line)", borderRadius: 8,
                    fontSize: 12, fontWeight: 600, color: "var(--teal)",
                    width: "100%", boxSizing: "border-box",
                    transition: ".12s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--teal)")}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--line)")}
                >
                  <span style={{ fontSize: 15, lineHeight: 1 }}>+</span> Add new line
                </button>

                {addingStx && (
                  <div style={{ background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 10, padding: 12, marginBottom: 8 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                      <div>
                        <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Service name <span style={{ color: "var(--red,#e74c3c)" }}>*</span></label>
                        <input style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13 }} ref={stxNameRef} defaultValue={newStxName} onBlur={e => setNewStxName(e.target.value)} placeholder="e.g. Texas Sales Tax" />
                      </div>
                      <div>
                        <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>RT # <span style={{ color: "var(--red,#e74c3c)" }}>*</span></label>
                        <input style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13 }} ref={stxRtRef} defaultValue={newStxRt} onBlur={e => setNewStxRt(e.target.value)} placeholder="e.g. 123456" />
                      </div>
                      <div>
                        <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Tax ID <span style={{ color: "var(--red,#e74c3c)" }}>*</span></label>
                        <input style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13 }} ref={stxTaxIdRef} defaultValue={newStxTaxId} onBlur={e => setNewStxTaxId(e.target.value)} placeholder="e.g. 74-1234567" />
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
                      <div>
                        <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Bank name</label>
                        <input style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13 }} ref={stxBankRef} defaultValue={newStxBank} onBlur={e => setNewStxBank(e.target.value)} placeholder="e.g. Chase" />
                      </div>
                      <div>
                        <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Routing #</label>
                        <input style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13 }} ref={stxRoutingRef} defaultValue={newStxRouting} onBlur={e => setNewStxRouting(e.target.value)} placeholder="e.g. 111000025" />
                      </div>
                      <div>
                        <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Account #</label>
                        <input style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13 }} ref={stxAccountRef} defaultValue={newStxAccount} onBlur={e => setNewStxAccount(e.target.value)} placeholder="e.g. 123456789" />
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                      <div>
                        <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Assigned to</label>
                        <select style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13, background: "#fff", color: "var(--ink)" }}
                          value={newStxAssigned} onChange={e => setNewStxAssigned(e.target.value)}>
                          <option value="">—</option>
                          {profiles.map((p: any) => <option key={p.id} value={p.name}>{firstName(p.name)}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Frequency</label>
                        <select style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13, background: "#fff", color: "var(--ink)" }}
                          value={newStxFreq} onChange={e => setNewStxFreq(e.target.value)}>
                          <option>Monthly</option><option>Quarterly</option><option>Annually</option>
                        </select>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <button className="reveal" style={{ all: "unset", cursor: "pointer", padding: "6px 12px", borderRadius: 8, fontWeight: 600, fontSize: 12, color: "var(--muted)" }}
                        onClick={() => setAddingStx(false)}>Cancel</button>
                      <button className="reveal" style={{
                        all: "unset", cursor: "pointer", padding: "6px 12px", borderRadius: 8, fontWeight: 600, fontSize: 12,
                        background: "var(--ink)", color: "#fff",
                      }}
                        onClick={() => {
                          const n = stxNameRef.current?.value.trim() || '';
                          const r = stxRtRef.current?.value.trim() || '';
                          const t = stxTaxIdRef.current?.value.trim() || '';
                          if (!n || !r || !t) return;
                          const upd = [...stxLineItems, {
                            serviceName: n, rt: r, taxId: t,
                            bankName: stxBankRef.current?.value.trim() || '',
                            bankRouting: stxRoutingRef.current?.value.trim() || '',
                            bankAccount: stxAccountRef.current?.value.trim() || '',
                            assignedTo: newStxAssigned,
                            frequency: newStxFreq,
                          }];
                          setStxLineItems(upd);
                          setLocalSvcs(prev => prev.map((s: any) => s.key === "sales_tax" ? { ...s, salesTaxLineItems: upd } : s));
                          // Save STX via PATCH (handles sales_tax_registration sync)
                          const stxSvc = localSvcs.find((s: any) => s.key === "sales_tax");
                          fetch("/api/clients", { method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ csId: stxSvc?.csId, salesTaxLineItems: upd }) }).catch(() => {});
                          [stxNameRef, stxRtRef, stxTaxIdRef, stxBankRef, stxRoutingRef, stxAccountRef].forEach(r => { if (r.current) r.current.value = ''; });
                          setNewStxFreq("Monthly"); setNewStxAssigned("");
                          setAddingStx(false);
                        }}
                      >Add line item</button>
                    </div>
                  </div>
                )}

                {stxLineItems.length > 0 && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)" }}>Line items</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {stxLineItems.map((item: any, i: number) => (
                        editingStxIdx === i ? (
                          <div key={i} style={{ background: "var(--paper)", border: "1px solid var(--teal)", borderRadius: 8, padding: 10 }}>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 6 }}>
                              <div>
                                <label style={{ fontSize: 9, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 2 }}>Service name</label>
                                <input style={{ width: "100%", padding: "5px 7px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12 }} ref={stxNameRef} defaultValue={editStxName} onBlur={e => setEditStxName(e.target.value)} />
                              </div>
                              <div>
                                <label style={{ fontSize: 9, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 2 }}>RT #</label>
                                <input style={{ width: "100%", padding: "5px 7px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12 }} ref={stxRtRef} defaultValue={editStxRt} onBlur={e => setEditStxRt(e.target.value)} />
                              </div>
                              <div>
                                <label style={{ fontSize: 9, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 2 }}>Tax ID</label>
                                <input style={{ width: "100%", padding: "5px 7px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12 }} ref={stxTaxIdRef} defaultValue={editStxTaxId} onBlur={e => setEditStxTaxId(e.target.value)} />
                              </div>
                              <div>
                                <label style={{ fontSize: 9, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 2 }}>Frequency</label>
                                <select style={{ width: "100%", padding: "5px 7px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12 }} value={editStxFreq} onChange={e => setEditStxFreq(e.target.value)}>
                                  <option>Monthly</option><option>Quarterly</option><option>Annually</option>
                                </select>
                              </div>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 8 }}>
                              <div>
                                <label style={{ fontSize: 9, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 2 }}>Bank name</label>
                                <input style={{ width: "100%", padding: "5px 7px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12 }} ref={stxBankRef} defaultValue={editStxBank} onBlur={e => setEditStxBank(e.target.value)} />
                              </div>
                              <div>
                                <label style={{ fontSize: 9, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 2 }}>Routing #</label>
                                <input style={{ width: "100%", padding: "5px 7px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12 }} ref={stxRoutingRef} defaultValue={editStxRouting} onBlur={e => setEditStxRouting(e.target.value)} />
                              </div>
                              <div>
                                <label style={{ fontSize: 9, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 2 }}>Account #</label>
                                <input style={{ width: "100%", padding: "5px 7px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12 }} ref={stxAccountRef} defaultValue={editStxAccount} onBlur={e => setEditStxAccount(e.target.value)} />
                              </div>
                              <div>
                                <label style={{ fontSize: 9, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 2 }}>Assigned to</label>
                                <select style={{ width: "100%", padding: "5px 7px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12, background: "#fff", color: "var(--ink)" }}
                                  value={editStxAssigned} onChange={e => setEditStxAssigned(e.target.value)}>
                                  <option value="">—</option>
                                  {profiles.map((p: any) => <option key={p.id} value={p.name}>{firstName(p.name)}</option>)}
                                </select>
                              </div>
                            </div>
                            <div style={{ marginTop: 6 }}>
                              <label style={{ fontSize: 9, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 2 }}>Notes</label>
                              <textarea
                                style={{ width: "100%", padding: "5px 7px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12, resize: "vertical", minHeight: 40 }}
                                defaultValue={editStxNotes}
                                onBlur={e => setEditStxNotes(e.target.value)}
                                placeholder="Add notes about this registration..."
                              />
                            </div>
                            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                              <button className="reveal" style={{ all: "unset", cursor: "pointer", color: "var(--muted)", fontWeight: 600, fontSize: 11, padding: "4px 8px" }}
                                onClick={() => setEditingStxIdx(-1)}>Cancel</button>
                              <button className="reveal" style={{ all: "unset", cursor: "pointer", background: "var(--teal)", color: "#fff", fontWeight: 600, fontSize: 11, padding: "4px 10px", borderRadius: 6 }}
                                onClick={() => {
                                  const n = stxNameRef.current?.value.trim() || '';
                                  if (!n) return;
                                  const upd = [...stxLineItems];
                                  upd[editingStxIdx] = {
                                    ...upd[editingStxIdx],
                                    serviceName: n, rt: stxRtRef.current?.value.trim() || '', taxId: stxTaxIdRef.current?.value.trim() || '',
                                    bankName: stxBankRef.current?.value.trim() || '', bankRouting: stxRoutingRef.current?.value.trim() || '', bankAccount: stxAccountRef.current?.value.trim() || '',
                                    assignedTo: editStxAssigned.trim(),
                                    frequency: editStxFreq,
                                    notes: editStxNotes.trim(),
                                  };
                                  setStxLineItems(upd);
                                  setLocalSvcs(prev => prev.map((s: any) => s.key === "sales_tax" ? { ...s, salesTaxLineItems: upd } : s));
                                  // Save STX via PATCH (handles sales_tax_registration sync)
                          const stxSvc = localSvcs.find((s: any) => s.key === "sales_tax");
                          fetch("/api/clients", { method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ csId: stxSvc?.csId, salesTaxLineItems: upd }) }).catch(() => {});
                                  setEditingStxIdx(-1);
                                }}>
                                Done
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div key={i} data-stx-name={item.serviceName} style={{
                            display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center",
                            background: (stxLineItemFocus && item.serviceName === stxLineItemFocus) ? "var(--amber-soft)" : "var(--paper)",
                            border: (stxLineItemFocus && item.serviceName === stxLineItemFocus) ? "2px solid var(--amber)" : "1px solid var(--line)",
                            borderRadius: 8, padding: "9px 11px",
                            transition: "border-color 0.3s, background 0.3s",
                          }}>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 3 }}>{item.serviceName}</div>
                              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 11, color: "var(--muted)" }}>
                                {item.assignedTo && <span>👤 {firstName(item.assignedTo)}</span>}
                                {item.rt && <span>RT: {item.rt}</span>}
                                {item.taxId && <span>Tax ID: {item.taxId}</span>}
                                {item.frequency && <span>{item.frequency}</span>}
                                {item.bankName && <span>{item.bankName} {item.bankRouting && `· ${item.bankRouting}`} {item.bankAccount && `· ${item.bankAccount}`}</span>}
                              </div>
                              {item.notes && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, fontStyle: "italic" }}>{item.notes}</div>}
                            </div>
                            <div style={{ display: "flex", gap: 4 }}>
                              <button className="reveal" style={{ all: "unset", cursor: "pointer", color: "var(--teal)", fontWeight: 600, fontSize: 11 }}
                                onClick={() => {
                                  setEditingStxIdx(i);
                                  setEditStxName(item.serviceName || "");
                                  setEditStxRt(item.rt || "");
                                  setEditStxTaxId(item.taxId || "");
                                  setEditStxBank(item.bankName || "");
                                  setEditStxRouting(item.bankRouting || "");
                                  setEditStxAccount(item.bankAccount || "");
                                  setEditStxFreq(item.frequency || "Monthly");
                                  setEditStxAssigned(item.assignedTo || "");
                                  setEditStxNotes(item.notes || "");
                                }}
                              >Edit</button>
                              <button className="reveal" style={{ all: "unset", cursor: "pointer", color: "var(--red)", fontWeight: 600, fontSize: 11 }}
                                onClick={() => {
                                  const upd = stxLineItems.filter((_, j) => j !== i);
                                  setStxLineItems(upd);
                                  setLocalSvcs(prev => prev.map((s: any) => s.key === "sales_tax" ? { ...s, salesTaxLineItems: upd } : s));
                                  // Save STX via PATCH (handles sales_tax_registration sync)
                          const stxSvc = localSvcs.find((s: any) => s.key === "sales_tax");
                          fetch("/api/clients", { method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ csId: stxSvc?.csId, salesTaxLineItems: upd }) }).catch(() => {});
                                }}
                              >✕</button>
                            </div>
                          </div>
                        )
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Renditions / Annual Reports: state renewal items */}
            {isAnnualReports && svc.enabled && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>
                  State Renewals ({renewalItems.length})
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", marginBottom: renewalItems.length > 0 ? 8 : 4 }}>
                  <input type="checkbox" checked={stateRenewal} onChange={e => {
                    setStateRenewal(e.target.checked);
                    saveServiceField("renditions", "stateRenewal", e.target.checked);
                  }} style={{ width: "auto" }} />
                  Enable state renewal tracking
                </label>
              </div>
            )}

            {/* Legend + Month cells — skip for sales tax (handled by line items) */}
            {!isSalesTax && (
              <>
                {svc.key === "1099s" ? (
                  <div className="legend" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 8, fontSize: 11, color: "var(--muted)" }}>
                    <span style={{ fontStyle: "italic" }}>Click to add, right-click to remove — count of 1099s filed per month</span>
                  </div>
                ) : (
                  <div className="legend" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 8, fontSize: 11, color: "var(--muted)" }}>
                    {UNIFIED_STAGES.map(s => (
                      <span key={s.k} className="lgd" style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <i style={{ width: 10, height: 10, borderRadius: 3, display: "inline-block", background: STAGE_STYLES[s.k]?.fg }}></i>
                        {isTaxReturns && s.k === "dn" ? "Filed" : s.l}
                      </span>
                    ))}
                    <span className="lgd" style={{ display: "flex", alignItems: "center", gap: 5 }}><i style={{ width: 10, height: 10, borderRadius: 3, display: "inline-block", background: "repeating-linear-gradient(45deg, var(--red) 0px, var(--red) 2px, transparent 2px, transparent 4px)" }}></i>N/A</span>
                    <span className="lgd" style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--blue)" }}><i style={{ width: 7, height: 7, borderRadius: "50%", display: "inline-block", background: "var(--blue)" }}></i>Has comments</span>
                  </div>
                )}
                {monthCells(svc.key)}
              </>
            )}
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════
  // MODULE-SPECIFIC VIEW (from worklist — shows detail for one module)
  // ══════════════════════════════════════════════════════════════
  if (moduleKey) {
    const targetSvc = localSvcs.find((s: any) => s.key === resolvedKey);
    if (!targetSvc) return null;

    // Resolve short/partial name to full profile name so select matches correctly
    const svcAssignee = targetSvc.assignedTo || targetSvc.processor || "Unassigned";
    const resolvedAssignee = svcAssignee !== "Unassigned" && !profiles.some((p: any) => p.name === svcAssignee)
      ? profiles.find((p: any) => {
          const parts = p.name.split(",").map((s: string) => s.trim().toLowerCase());
          const svc = svcAssignee.toLowerCase();
          return p.name.toLowerCase().includes(svc) || parts.some((part: string) => svc.includes(part));
        })?.name || svcAssignee
      : svcAssignee;

    function handleAddNoteForModule() {
      if (!notesText.trim()) return;
      // Do not add service-level notes on Sales Tax or Annual Reports tabs (notes are per-line-item)
      if (moduleKey === "sales_tax" || moduleKey === "annual_reports") return;
      const prefix = noteType !== "others" ? `[${noteType}] ` : "";
      const comment: CommentEntry = {
        id: `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        month: notesMonth,
        text: prefix + notesText.trim(),
        author: getAuthorName(),
        createdAt: new Date().toISOString(),
      };
      const updated = localSvcs.map((s: any) => {
        if (s.key === resolvedKey) {
          const existing = s.comments || [];
          return { ...s, comments: [...existing, comment] };
        }
        return s;
      });
      setLocalSvcs(updated);
      setNotesText("");
      setNoteType("others");
      // Jump to last page so new note is visible
      const targetSvc = updated.find((s: any) => s.key === resolvedKey);
      const newTotal = (targetSvc?.comments || []).length;
      setNotePage(Math.floor(Math.max(0, newTotal - 1) / 3));
      // Immediate PUT — bypass throttle to ensure notes persist
      fetch("/api/clients", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...client, services: updated }),
      }).catch(e => console.error("[addNote] PUT failed:", e));
    }

    function syncAndAutoSaveModule() {
      // Ensure payroll separate state is synced into localSvcs before saving
      const synced = localSvcs.map((s: any) => {
        if (s.key === "payroll") {
          return {
            ...s,
            paydate: prPaydate,
            pay_start_date: prStartDate,
            payrollPassword: prPinRef.current?.value ?? prPin,
            eftps: prEftpsRef.current?.value ?? prEftps,
            payEmails: prEmails,
            payPeriodFrequency: prPeriodFreq,
            frequency: prPeriodFreq,
            reportingMethod: prReportingMethod,
            payrollCategory: prPayrollCategory,
            qbLicense: prQbLicense,
            reportingNotes: reportingRef.current?.value ?? prReportingNotes,
          };
        }
        if (s.key === "tax_returns") {
          return { ...s, filingState, filingMonth, filingType };
        }
        return s;
      });
      autoSave({
        ...c,
        active: isActive,
        services: synced,
        name: eName, type: eType as "Business" | "Personal", group: eGroup,
        contact: eContact,
        emails: [eEmailRef.current?.value ?? eEmail, eAddEmailRef.current?.value ?? eAddEmail].filter(Boolean),
        phones: [ePhoneRef.current?.value ?? ePhone, eAddPhoneRef.current?.value ?? eAddPhone].filter(Boolean),
        address: eAddressRef.current?.value ?? eAddress, city: eCityRef.current?.value ?? eCity, state: eStateRef.current?.value ?? eState, zip: eZipRef.current?.value ?? eZip,
        ein: eEinRef.current?.value ?? eEin,
        notes: eNotesRef.current?.value ?? eNotes,
        assignedStaff: eAssigned,
      } as Client);
    }

    /** Helper: updates local services state and queues autosave with a proper Client payload.
     *  Prevents function-payload corruption where outer autoSave received prev => prev.map(...)
     *  instead of a Client object. */
    function updateServicesAndAutoSave(updater: (svcs: any[]) => any[]) {
      const updated = updater(localSvcs);
      setLocalSvcs(updated);
      autoSave({ ...c, services: updated } as Client);
    }

    // ── Sales tax line item section ──
    function SalesTaxLineItemsSection() {
      const [editingStxIdx, setEditingStxIdx] = useState(-1);
      const [editStxName, setEditStxName] = useState("");
      const [editStxFreq, setEditStxFreq] = useState("Monthly");
      const [editStxRt, setEditStxRt] = useState("");
      const [editStxTaxId, setEditStxTaxId] = useState("");
      const [editStxBank, setEditStxBank] = useState("");
      const [editStxRouting, setEditStxRouting] = useState("");
      const [editStxAccount, setEditStxAccount] = useState("");
      const [editStxAssigned, setEditStxAssigned] = useState("");
      const [stxItemNoteText, setStxItemNoteText] = useState<Record<number, string>>({});
      const [stxItemNoteMonth, setStxItemNoteMonth] = useState<Record<number, number>>({});

      function startEdit(i: number) {
        const item = stxLineItems[i];
        setEditingStxIdx(i);
        setEditStxName(item.serviceName || "");
        setEditStxFreq(item.frequency || "Monthly");
        setEditStxRt(item.rt || "");
        setEditStxTaxId(item.taxId || "");
        setEditStxBank(item.bankName || "");
        setEditStxRouting(item.bankRouting || "");
        setEditStxAccount(item.bankAccount || "");
        setEditStxAssigned(item.assignedTo || "");
      }

      function saveEditItem() {
        if (editingStxIdx < 0 || !(stxNameRef.current?.value.trim())) return;
        const upd = [...stxLineItems];
        upd[editingStxIdx] = {
          ...upd[editingStxIdx],
          serviceName: stxNameRef.current?.value.trim() || '', rt: stxRtRef.current?.value.trim() || '', taxId: stxTaxIdRef.current?.value.trim() || '',
          bankName: stxBankRef.current?.value.trim() || '', bankRouting: stxRoutingRef.current?.value.trim() || '', bankAccount: stxAccountRef.current?.value.trim() || '',
          assignedTo: editStxAssigned.trim(),
          frequency: editStxFreq,
        };
        setStxLineItems(upd);
        setLocalSvcs((prev: any) => prev.map((s: any) => s.key === "sales_tax" ? { ...s, salesTaxLineItems: upd } : s));
        autoSave({
          ...client,
          services: localSvcs.map((s: any) => s.key === "sales_tax" ? { ...s, salesTaxLineItems: upd } : s),
        } as Client);
      }

      /** Autosave STX edit fields without exiting edit mode. Accepts overrides to avoid stale state. */
      function autoSaveStxFields(overrides?: { assignedTo?: string; frequency?: string }) {
        if (editingStxIdx < 0 || !(stxNameRef.current?.value.trim())) return;
        const upd = [...stxLineItems];
        upd[editingStxIdx] = {
          ...upd[editingStxIdx],
          serviceName: stxNameRef.current?.value.trim() || '', rt: stxRtRef.current?.value.trim() || '', taxId: stxTaxIdRef.current?.value.trim() || '',
          bankName: stxBankRef.current?.value.trim() || '', bankRouting: stxRoutingRef.current?.value.trim() || '', bankAccount: stxAccountRef.current?.value.trim() || '',
          assignedTo: (overrides?.assignedTo ?? editStxAssigned).trim(),
          frequency: overrides?.frequency ?? editStxFreq,
        };
        setStxLineItems(upd);
        setLocalSvcs((prev: any) => prev.map((s: any) => s.key === "sales_tax" ? { ...s, salesTaxLineItems: upd } : s));
        autoSave({
          ...client,
          services: localSvcs.map((s: any) => s.key === "sales_tax" ? { ...s, salesTaxLineItems: upd } : s),
        } as Client);
      }

      /** Done button: saves and exits edit mode */
      function doneEditItem() {
        saveEditItem();
        setEditingStxIdx(-1);
      }

      function removeItem(i: number) {
        const upd = stxLineItems.filter((_: any, j: number) => j !== i);
        setStxLineItems(upd);
        setLocalSvcs((prev: any) => prev.map((s: any) => s.key === "sales_tax" ? { ...s, salesTaxLineItems: upd } : s));
        autoSave({
          ...client,
          services: localSvcs.map((s: any) => s.key === "sales_tax" ? { ...s, salesTaxLineItems: upd } : s),
        } as Client);
      }

      function addStxItemNote(itemIdx: number) {
        const text = (stxItemNoteText[itemIdx] || "").trim();
        if (!text) return;
        const month = stxItemNoteMonth[itemIdx] ?? new Date().getMonth();
        const comment: CommentEntry = {
          id: `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          month,
          text,
          author: getAuthorName(),
          createdAt: new Date().toISOString(),
        };
        const items = stxLineItems.map((it: any, i: number) =>
          i === itemIdx ? { ...it, comments: [...(it.comments || []), comment] } : it
        );
        setStxLineItems(items);
        setLocalSvcs((prev: any) => prev.map((s: any) =>
          s.key === "sales_tax" ? { ...s, salesTaxLineItems: items } : s
        ));
        setStxItemNoteText((prev: any) => ({ ...prev, [itemIdx]: "" }));
        const stxSvc = localSvcs.find((s: any) => s.key === "sales_tax");
        if (stxSvc?.csId) {
          fetch("/api/clients", { method: "PATCH", headers: {"Content-Type":"application/json"},
            body: JSON.stringify({ csId: stxSvc.csId, salesTaxLineItems: items }) }).catch(() => {});
        }
      }

      function deleteStxItemComment(itemIdx: number, commentId: string) {
        const items = stxLineItems.map((it: any, i: number) =>
          i === itemIdx ? { ...it, comments: (it.comments || []).filter((c: any) => c.id !== commentId) } : it
        );
        setStxLineItems(items);
        setLocalSvcs((prev: any) => prev.map((s: any) =>
          s.key === "sales_tax" ? { ...s, salesTaxLineItems: items } : s
        ));
        const stxSvc = localSvcs.find((s: any) => s.key === "sales_tax");
        if (stxSvc?.csId) {
          fetch("/api/clients", { method: "PATCH", headers: {"Content-Type":"application/json"},
            body: JSON.stringify({ csId: stxSvc.csId, salesTaxLineItems: items }) }).catch(() => {});
        }
      }

      // Per-line-item month stage
      function stxMonthStage(itemIdx: number, monthIdx: number): string {
        // Return the stage of the parent sales_tax service for that month
        return (targetSvc?.months || [])[monthIdx] || "lock";
      }

      function handleStxStageClick(itemIdx: number, monthIdx: number) {
        // Same stage cycling as the parent month tracker
        const svc = localSvcs.find((s: any) => s.key === "sales_tax");
        const currentStage = (svc?.months || [])[monthIdx] || "lock";
        const STAGE_CYCLE = ["lock", "in_progress", "waiting", "billed", "delayed", "done", "na"];
        const idx = STAGE_CYCLE.indexOf(currentStage);
        const nextStage = STAGE_CYCLE[(idx + 1) % STAGE_CYCLE.length];
        const updated = localSvcs.map((s: any) =>
          s.key === "sales_tax"
            ? { ...s, months: s.months.map((m: string, i: number) => i === monthIdx ? nextStage : m) }
            : s
        );
        setLocalSvcs(updated);
        autoSave({ ...client, services: updated } as Client);
      }

      const stxStageStyles: Record<string, { bg: string; fg: string; border: string }> = {
        lock: { bg: "transparent", fg: "#c2c8d4", border: "transparent" },
        in_progress: { bg: "var(--blue-soft)", fg: "var(--blue)", border: "#bcd0e2" },
        waiting: { bg: "var(--amber-soft)", fg: "var(--amber)", border: "#e8d3a6" },
        billed: { bg: "var(--teal-soft)", fg: "var(--teal-ink)", border: "#c5d0ec" },
        done: { bg: "var(--green-soft)", fg: "var(--green)", border: "#bcdcc6" },
        na: { bg: "var(--red-soft)", fg: "var(--red)", border: "#e8c4bf" },
      };

      function stxStageSymbol(st: string): string {
        switch (st) {
          case "lock": return "·";
          case "in_progress": return "•";
          case "waiting": return "⏳";
          case "billed": return "✓";
          case "done": return "✓";
          case "na": return "–";
          default: return "·";
        }
      }

      return (
        <div style={{ marginBottom: 12 }}>
          <div className="sect" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)", margin: "0 0 8px" }}>
            Sales Tax Line Items
          </div>

          <button
            onClick={() => setAddingStx(!addingStx)}
            className="reveal"
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 12px", marginBottom: 8,
              border: "1px dashed var(--line)", borderRadius: 8,
              fontSize: 12, fontWeight: 600, color: "var(--teal)",
              width: "100%", boxSizing: "border-box",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--teal)")}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--line)")}
          >
            <span style={{ fontSize: 15, lineHeight: 1 }}>+</span> Add line item
          </button>

          {addingStx && (
            <div style={{ background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 10, padding: 12, marginBottom: 8 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Service name</label>
                  <input style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13 }} ref={stxNameRef} defaultValue={newStxName} onBlur={e => setNewStxName(e.target.value)} placeholder="e.g. Texas Sales Tax" />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>RT #</label>
                  <input style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13 }} ref={stxRtRef} defaultValue={newStxRt} onBlur={e => setNewStxRt(e.target.value)} placeholder="e.g. 123456" />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Tax ID</label>
                  <input style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13 }} ref={stxTaxIdRef} defaultValue={newStxTaxId} onBlur={e => setNewStxTaxId(e.target.value)} placeholder="e.g. 74-1234567" />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Bank name</label>
                  <input style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13 }} ref={stxBankRef} defaultValue={newStxBank} onBlur={e => setNewStxBank(e.target.value)} placeholder="e.g. Chase" />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Routing #</label>
                  <input style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13 }} ref={stxRoutingRef} defaultValue={newStxRouting} onBlur={e => setNewStxRouting(e.target.value)} placeholder="e.g. 111000025" />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Account #</label>
                  <input style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13 }} ref={stxAccountRef} defaultValue={newStxAccount} onBlur={e => setNewStxAccount(e.target.value)} placeholder="e.g. 123456789" />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Assigned to</label>
                  <select style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13, background: "#fff", color: "var(--ink)" }}
                    value={newStxAssigned} onChange={e => setNewStxAssigned(e.target.value)}>
                    <option value="">—</option>
                    {profiles.map((p: any) => <option key={p.id} value={p.name}>{firstName(p.name)}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Frequency</label>
                  <select style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13, background: "#fff", color: "var(--ink)" }}
                    value={newStxFreq} onChange={e => setNewStxFreq(e.target.value)}>
                    <option>Monthly</option><option>Quarterly</option><option>Annually</option>
                  </select>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button className="reveal" style={{ all: "unset", cursor: "pointer", padding: "6px 12px", borderRadius: 8, fontWeight: 600, fontSize: 12, color: "var(--muted)" }}
                  onClick={() => setAddingStx(false)}>Cancel</button>
                <button className="reveal" style={{ all: "unset", cursor: "pointer", background: "var(--ink)", color: "#fff", padding: "6px 12px", borderRadius: 8, fontWeight: 600, fontSize: 12 }}
                  onClick={() => {
                    const n = stxNameRef.current?.value.trim() || '';
                    const r = stxRtRef.current?.value.trim() || '';
                    const t = stxTaxIdRef.current?.value.trim() || '';
                    if (!n || !r || !t) return;
                    const upd = [...stxLineItems, {
                      serviceName: n, rt: r, taxId: t,
                      bankName: stxBankRef.current?.value.trim() || '',
                      bankRouting: stxRoutingRef.current?.value.trim() || '',
                      bankAccount: stxAccountRef.current?.value.trim() || '',
                      assignedTo: newStxAssigned,
                      frequency: newStxFreq,
                    }];
                    setStxLineItems(upd);
                    setLocalSvcs((prev: any) => prev.map((s: any) => s.key === "sales_tax" ? { ...s, salesTaxLineItems: upd } : s));
                    // Save STX via PATCH (handles sales_tax_registration sync)
                          const stxSvc = localSvcs.find((s: any) => s.key === "sales_tax");
                          fetch("/api/clients", { method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ csId: stxSvc?.csId, salesTaxLineItems: upd }) }).catch(() => {});
                    [stxNameRef, stxRtRef, stxTaxIdRef, stxBankRef, stxRoutingRef, stxAccountRef].forEach(r => { if (r.current) r.current.value = ''; });
                    setNewStxFreq("Monthly"); setNewStxAssigned("");
                    setAddingStx(false);
                  }}
                >Add line item</button>
              </div>
            </div>
          )}

          {stxLineItems.map((item: any, i: number) => (
            <div key={i} className="stxitem">
              {editingStxIdx === i ? (
                <div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Service name</label>
                      <input style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13 }} ref={stxNameRef} defaultValue={editStxName} onBlur={e => { setEditStxName(e.target.value); autoSaveStxFields(); }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>RT #</label>
                      <input style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13 }} ref={stxRtRef} defaultValue={editStxRt} onBlur={e => { setEditStxRt(e.target.value); autoSaveStxFields(); }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Tax ID</label>
                      <input style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13 }} ref={stxTaxIdRef} defaultValue={editStxTaxId} onBlur={e => { setEditStxTaxId(e.target.value); autoSaveStxFields(); }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Bank name</label>
                      <input style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13 }} ref={stxBankRef} defaultValue={editStxBank} onBlur={e => { setEditStxBank(e.target.value); autoSaveStxFields(); }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Routing #</label>
                      <input style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13 }} ref={stxRoutingRef} defaultValue={editStxRouting} onBlur={e => { setEditStxRouting(e.target.value); autoSaveStxFields(); }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Account #</label>
                      <input style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13 }} ref={stxAccountRef} defaultValue={editStxAccount} onBlur={e => { setEditStxAccount(e.target.value); autoSaveStxFields(); }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Assigned to</label>
                      <select style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13, background: "#fff", color: "var(--ink)" }}
                        value={editStxAssigned} onChange={e => { setEditStxAssigned(e.target.value); autoSaveStxFields({ assignedTo: e.target.value }); }}>
                        <option value="">—</option>
                        {profiles.map((p: any) => <option key={p.id} value={p.name}>{firstName(p.name)}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Frequency</label>
                      <select style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13, background: "#fff", color: "var(--ink)" }}
                        value={editStxFreq} onChange={e => { setEditStxFreq(e.target.value); autoSaveStxFields({ frequency: e.target.value }); }}>
                        <option>Monthly</option><option>Quarterly</option><option>Annually</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button className="reveal" style={{ color: "var(--muted)" }} onClick={() => setEditingStxIdx(-1)}>Cancel</button>
                    <button className="reveal" style={{ background: "var(--teal)", color: "#fff", padding: "6px 12px", borderRadius: 8 }} onClick={doneEditItem}>Done</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="stxih">
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{item.serviceName}</div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="reveal" onClick={() => startEdit(i)} style={{ fontSize: 11 }}>Edit</button>
                      <button className="reveal" onClick={() => removeItem(i)} style={{ color: "var(--red)", fontSize: 11 }}>Remove</button>
                    </div>
                  </div>

                  <div className="stxfields">
                    <div>
                      <span className="fk">Frequency</span>
                      <span className="fv">{item.frequency || "Monthly"}</span>
                    </div>
                    <div>
                      <span className="fk">RT #</span>
                      <span className="fv mono">{item.rt || "—"}</span>
                    </div>
                    <div>
                      <span className="fk">Tax ID</span>
                      <span className="fv mono">{item.taxId || "—"}</span>
                    </div>
                    <div>
                      <span className="fk">Bank</span>
                      <span className="fv">{item.bankName || "—"}</span>
                    </div>
                    <div>
                      <span className="fk">Routing</span>
                      <span className="fv mono">{displayBankNumber(item.bankRouting)}</span>
                    </div>
                    <div>
                      <span className="fk">Account</span>
                      <span className="fv mono">{displayBankNumber(item.bankAccount)}</span>
                    </div>
                    <div>
                      <span className="fk">Assigned to</span>
                      <span className="fv">{item.assignedTo ? firstName(item.assignedTo) : "—"}</span>
                    </div>
                  </div>

                  {/* Per-line-item month tracker */}
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", marginBottom: 6 }}>Month tracker</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {MONTHS.map((mo, mi) => {
                        const st = stxMonthStage(i, mi);
                        const ss = stxStageStyles[st] || stxStageStyles.lock;
                        const hasCmt = (item.comments || []).some((c: any) => c.month === mi);
                        return (
                          <div key={mi} style={{ textAlign: "center", position: "relative" }}>
                            <div style={{ fontSize: 9, color: "var(--muted)", marginBottom: 1 }}>{mo}</div>
                            <div
                              style={{
                                width: 24, height: 24, borderRadius: 6,
                                border: `1px solid ${ss.border}`,
                                background: ss.bg,
                                color: ss.fg,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: 12, fontWeight: 700, cursor: "default", userSelect: "none",
                                position: "relative",
                              }}
                            >
                              {stxStageSymbol(st)}
                              {hasCmt && <div className="cdot" />}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* ── Per-item notes + comments ── */}
                  <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px dashed var(--line)" }}>
                    <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                      <select
                        value={stxItemNoteMonth[i] ?? new Date().getMonth()}
                        onChange={e => setStxItemNoteMonth((prev: any) => ({ ...prev, [i]: Number(e.target.value) }))}
                        style={{ padding: "4px 6px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 11, background: "var(--paper)", color: "var(--ink)" }}>
                        {MONTHS.map((m, mi) => <option key={mi} value={mi}>{m.substring(0, 3)}</option>)}
                      </select>
                      <input
                        value={stxItemNoteText[i] || ""}
                        onChange={e => setStxItemNoteText((prev: any) => ({ ...prev, [i]: e.target.value }))}
                        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addStxItemNote(i); } }}
                        placeholder="Add note..."
                        style={{ flex: 1, padding: "4px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 11, background: "var(--paper)", color: "var(--ink)", outline: "none" }} />
                      <button
                        onClick={() => addStxItemNote(i)}
                        style={{ all: "unset", cursor: "pointer", background: "var(--teal)", color: "#fff", padding: "4px 10px", borderRadius: 6, fontWeight: 600, fontSize: 11, whiteSpace: "nowrap" }}>Add</button>
                    </div>
                    {(item.comments || []).length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {(item.comments || []).sort((a: any, b: any) => a.month - b.month || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()).map((cm: any) => (
                          <div key={cm.id} style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "4px 8px", background: "var(--grey-soft)", borderRadius: 6, fontSize: 11 }}>
                            <span style={{ flex: 1, color: "var(--ink)" }}>{cm.text}</span>
                            <span style={{ color: "var(--muted)", fontSize: 10, whiteSpace: "nowrap" }}>{MONTHS[cm.month]} · {cm.author}</span>
                            <button
                              onClick={() => deleteStxItemComment(i, cm.id)}
                              style={{ all: "unset", cursor: "pointer", color: "var(--red)", fontSize: 13, fontWeight: 700, lineHeight: 1 }}>×</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      );
    }

    return (
      <>
        <div className="scrim show" onClick={() => { syncAndAutoSaveModule(); flushSave(); onClose(); }} />
        <div className="over show" style={{
          background: "var(--paper)", boxShadow: "-12px 0 40px rgba(33,31,26,.18)",
        }}>
          {/* Header */}
          <div className="ohead" style={{
            padding: "22px 24px 16px", borderBottom: "1px solid var(--line)", background: "var(--card)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
              <div>
                <div className="nm" style={{ fontFamily: '"Fraunces",Georgia,serif', fontWeight: 600, fontSize: 23, lineHeight: 1.12 }}>{c.name}</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3, display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <span>📁 {(c.groupName || c.group) && (c.groupName || c.group).toLowerCase() !== "unassigned" ? (c.groupName || c.group) : "—"}</span>
                  <span>👤 {c.contact || "—"}</span>
                </div>
              </div>
              <button className="ox" onClick={() => { syncAndAutoSaveModule(); flushSave(); onClose(); }} style={{ all: "unset", cursor: "pointer", fontSize: 22, color: "var(--muted)", lineHeight: 1 }}>×</button>
            </div>
            <div className="sub" style={{ color: "var(--muted)", fontSize: 13, marginTop: 5 }}>
              <span className="badge b-biz" style={{
                fontSize: "10.5px", fontWeight: 700, padding: "3px 9px", borderRadius: 20,
                textTransform: "uppercase", letterSpacing: "0.05em",
                backgroundColor: typeBadge.bg, color: typeBadge.fg, marginLeft: 6,
              }}>{c.type === "Business" ? "BIZ" : "PERS"}</span>
              <span className="badge"
                onClick={toggleActive}
                style={{
                  fontSize: "10.5px", fontWeight: 700, padding: "3px 9px", borderRadius: 20,
                  textTransform: "uppercase", letterSpacing: "0.05em", cursor: "pointer",
                  backgroundColor: isActive ? "var(--green-soft,#e6f4ea)" : "var(--red-soft,#fce8e6)",
                  color: isActive ? "var(--green,#1e7e34)" : "var(--red,#c62828)",
                  marginLeft: 6,
                }}>
                {isActive ? "ACTIVE" : "INACTIVE"}
              </span>
            </div>
          </div>

          {/* Body */}
          <div className="obody" ref={bodyRef} onScroll={saveScroll} style={{ overflowY: "auto", padding: "20px 24px 30px", flex: 1 }}>
            {/* Module tag badge */}
            <span className="modtag" style={{ marginBottom: 12 }}>{svcIc(moduleKey)} {svcLabel(moduleKey)}</span>

            {/* State Renewal — multi-state support in Annual Reports tab */}
            {moduleKey === "annual_reports" && (() => {
              /** Autosave current renewal edit item without exiting edit mode. Accepts overrides for fresh values. */
              function saveCurrentRenewal(overrides?: { state?: string; month?: string; day?: string; ids?: string; assigned?: string }) {
                const idx = editingRenewalIdx;
                if (idx === null || idx < 0) return;
                const st = overrides?.state ?? renewalAddStateRef.current?.value ?? renewalItems[idx]?.state;
                const mo = overrides?.month ?? renewalAddMonthRef.current?.value ?? renewalItems[idx]?.dueMonth;
                const dy = overrides?.day ?? renewalAddDayRef.current?.value ?? renewalItems[idx]?.dueDay;
                const ids = overrides?.ids ?? renewalAddIdsRef.current?.value ?? "";
                const assigned = overrides?.assigned ?? renewalAddAssignedRef.current?.value ?? "";
                const updated = renewalItems.map((it: any, i: number) =>
                  i === idx ? { ...it, state: st, dueMonth: mo, dueDay: dy, identifiers: ids, assignedTo: assigned } : it
                );
                setRenewalItems(updated);
                setLocalSvcs((prev: any) => {
                  const targetKey = findRenewalService(prev)?.key || "annual_reports";
                  return prev.map((s: any) => s.key === targetKey ? { ...s, stateRenewalItems: updated } : s);
                });
                syncRenewalItems(updated);
              }
            return (
            <div className="card" style={{ marginBottom: 16, padding: 14, background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)", display: "flex", alignItems: "center", gap: 6, cursor: "pointer", marginBottom: stateRenewal || renewalItems.length > 0 ? 10 : 0 }}>
                <input type="checkbox" checked={stateRenewal} onChange={e => {
                  setStateRenewal(e.target.checked);
                  saveServiceField("renditions", "stateRenewal", e.target.checked);
                }} style={{ width: "auto" }} />
                State renewal
              </label>

              {/* Existing state renewal items */}
              {renewalItems.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                  {renewalItems.map((item: any, idx: number) => (
                    editingRenewalIdx === idx ? (
                      // ── Edit mode ──
                      <div key={item.id || idx} style={{
                        background: "var(--paper)", border: "1px solid var(--teal)", borderRadius: 8, padding: 10
                      }}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-end" }}>
                          <div style={{ flex: "1 0 50px" }}>
                            <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 2 }}>State</label>
                            <select ref={renewalAddStateRef} defaultValue={item.state} onChange={() => saveCurrentRenewal({ state: renewalAddStateRef.current?.value })} style={{ width: "100%", padding: "5px 6px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12, background: "var(--paper)" }}>
                              {US_STATES.map(st => <option key={st} value={st}>{st}</option>)}
                            </select>
                          </div>
                          <div style={{ flex: "1 0 50px" }}>
                            <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 2 }}>Month</label>
                            <select ref={renewalAddMonthRef} defaultValue={item.dueMonth} onChange={() => saveCurrentRenewal({ month: renewalAddMonthRef.current?.value })} style={{ width: "100%", padding: "5px 6px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12, background: "var(--paper)" }}>
                              {MONTH_NAMES.map((m, i) => <option key={i} value={String(i + 1)}>{m}</option>)}
                            </select>
                          </div>
                          <div style={{ flex: "0 0 40px" }}>
                            <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 2 }}>Day</label>
                            <input ref={renewalAddDayRef} type="number" min="1" max="31" defaultValue={item.dueDay} onBlur={() => saveCurrentRenewal()} style={{ width: "100%", padding: "5px 6px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12, background: "var(--paper)" }} />
                          </div>
                          <div style={{ flex: "1.5 0 80px" }}>
                            <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 2 }}>IDs</label>
                            <input ref={renewalAddIdsRef} defaultValue={item.identifiers} placeholder="e.g. EIN" onBlur={() => saveCurrentRenewal()} style={{ width: "100%", padding: "5px 6px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12, background: "var(--paper)" }} />
                          </div>
                          <div style={{ flex: "1 0 80px" }}>
                            <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 2 }}>Assigned</label>
                            <select ref={renewalAddAssignedRef} defaultValue={item.assignedTo || ""} onChange={() => saveCurrentRenewal({ assigned: renewalAddAssignedRef.current?.value })} style={{ width: "100%", padding: "5px 6px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12, background: "var(--paper)" }}>
                              <option value="">Unassigned</option>
                              {profiles.map((p: any) => <option key={p.id} value={p.name}>{firstName(p.name)}</option>)}
                            </select>
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
                          <button onClick={() => setEditingRenewalIdx(null)}
                            style={{ all: "unset", cursor: "pointer", padding: "5px 10px", borderRadius: 6, fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Cancel</button>
                          <button onClick={() => {
                            saveCurrentRenewal();
                            setEditingRenewalIdx(null);
                          }}
                            style={{ all: "unset", cursor: "pointer", padding: "5px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: "var(--ink)", color: "#fff" }}>Done</button>
                        </div>
                      </div>
                    ) : (
                      // ── Display mode ──
                      <div key={item.id || idx} style={{
                        background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden"
                      }}>
                        <div style={{
                          display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", fontSize: 12
                        }}>
                        <span style={{ fontWeight: 600, minWidth: 30, color: "var(--teal)" }}>{item.state}</span>
                        <span style={{ color: "var(--muted)" }}>
                          Due: {item.dueMonth ? `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][Math.max(0,Math.min(11,parseInt(item.dueMonth||"1")-1))] || item.dueMonth}${item.dueDay ? ` ${item.dueDay}` : ""}` : "—"}
                        </span>
                        {item.identifiers && <span style={{ color: "var(--muted)", fontSize: 10 }}>{item.identifiers}</span>}
                        <span style={{ color: "var(--muted)", fontSize: 11, fontWeight: 500 }}>{item.assignedTo || "Unassigned"}</span>
                        <div style={{ flex: 1 }} />
                        <button
                          onClick={() => {
                            setEditingRenewalIdx(idx);
                          }}
                          style={{ all: "unset", cursor: "pointer", color: "var(--blue)", fontSize: 11, fontWeight: 600 }}
                        >✎</button>
                        <button
                          onClick={() => {
                            const updated = renewalItems.filter((_: any, i: number) => i !== idx);
                            setRenewalItems(updated);
                            const targetKey = findRenewalService(localSvcs)?.key || "annual_reports";
                            const newSvcs = localSvcs.map((s: any) => s.key === targetKey ? { ...s, stateRenewalItems: updated } : s);
                            setLocalSvcs(newSvcs);
                            const rendSvc = findRenewalService(newSvcs);
                            if (rendSvc?.csId) {
                              fetch("/api/clients", { method: "PATCH", headers: {"Content-Type":"application/json"},
                                body: JSON.stringify({ csId: rendSvc.csId, stateRenewalItems: updated }) }).catch(() => {});
                            }
                          }}
                          style={{ all: "unset", cursor: "pointer", color: "var(--red)", fontSize: 11, fontWeight: 600 }}
                        >×</button>
                        </div>
                        {/* ── Notes section ── */}
                        <div style={{ padding: "6px 10px", borderTop: "1px solid var(--line)", background: "var(--card)" }}>
                          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                            <select
                              value={renewalNoteMonth[idx] ?? new Date().getMonth()}
                              onChange={e => setRenewalNoteMonth((prev: any) => ({ ...prev, [idx]: Number(e.target.value) }))}
                              style={{ padding: "4px 6px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 11, background: "#fff", color: "var(--ink)" }}>
                              {MONTHS.map((m, mi) => <option key={mi} value={mi}>{m.substring(0, 3)}</option>)}
                            </select>
                            <input
                              value={renewalNoteText[idx] || ""}
                              onChange={e => setRenewalNoteText((prev: any) => ({ ...prev, [idx]: e.target.value }))}
                              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addRenewalItemNote(idx); } }}
                              placeholder="Add note..."
                              style={{ flex: 1, padding: "4px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 11, background: "#fff", color: "var(--ink)", outline: "none" }} />
                            <button
                              onClick={() => addRenewalItemNote(idx)}
                              style={{ all: "unset", cursor: "pointer", background: "var(--teal)", color: "#fff", padding: "4px 10px", borderRadius: 6, fontWeight: 600, fontSize: 11, whiteSpace: "nowrap" }}>Add</button>
                          </div>
                          {(item.comments || []).length > 0 && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              {(item.comments || []).sort((a: any, b: any) => a.month - b.month || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()).map((cm: any) => (
                                <div key={cm.id} style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "4px 8px", background: "var(--grey-soft)", borderRadius: 6, fontSize: 11 }}>
                                  <span style={{ flex: 1, color: "var(--ink)" }}>{cm.text}</span>
                                  <span style={{ color: "var(--muted)", fontSize: 10, whiteSpace: "nowrap" }}>{MONTHS[cm.month]} · {cm.author}</span>
                                  <button
                                    onClick={() => deleteRenewalItemComment(idx, cm.id)}
                                    style={{ all: "unset", cursor: "pointer", color: "var(--red)", fontSize: 13, fontWeight: 700, lineHeight: 1 }}>×</button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  ))}
                </div>
              )}

              {/* Add form */}
              {addingRenewal ? (
                <div style={{ background: "var(--paper)", border: "1px solid var(--teal)", borderRadius: 8, padding: 10, marginBottom: 8 }}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-end" }}>
                    <div style={{ flex: "1 0 70px" }}>
                      <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 2 }}>State</label>
                      <select ref={renewalAddStateRef} style={{ width: "100%", padding: "5px 6px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12, background: "var(--paper)" }}>
                        {US_STATES.map(st => <option key={st} value={st}>{st}</option>)}
                      </select>
                    </div>
                    <div style={{ flex: "1 0 70px" }}>
                      <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 2 }}>Month</label>
                      <select ref={renewalAddMonthRef} style={{ width: "100%", padding: "5px 6px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12, background: "var(--paper)" }}>
                        {MONTH_NAMES.map((m, i) => <option key={i} value={String(i + 1)}>{m}</option>)}
                      </select>
                    </div>
                    <div style={{ flex: "0 0 50px" }}>
                      <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 2 }}>Day</label>
                      <input ref={renewalAddDayRef} type="number" min="1" max="31" defaultValue="1" style={{ width: "100%", padding: "5px 6px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12, background: "var(--paper)" }} />
                    </div>
                    <div style={{ flex: "2 0 100px" }}>
                      <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 2 }}>IDs</label>
                      <input ref={renewalAddIdsRef} placeholder="e.g. EIN" style={{ width: "100%", padding: "5px 6px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12, background: "var(--paper)" }} />
                    </div>
                    <div style={{ flex: "1.5 0 100px" }}>
                      <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 2 }}>Assigned</label>
                      <select ref={renewalAddAssignedRef} style={{ width: "100%", padding: "5px 6px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12, background: "var(--paper)" }}>
                        <option value="">Unassigned</option>
                        {profiles.map((p: any) => <option key={p.id} value={p.name}>{firstName(p.name)}</option>)}
                      </select>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
                    <button onClick={() => setAddingRenewal(false)}
                      style={{ all: "unset", cursor: "pointer", padding: "5px 10px", borderRadius: 6, fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Cancel</button>
                    <button onClick={() => {
                      const st = renewalAddStateRef.current?.value || "TX";
                      const mo = renewalAddMonthRef.current?.value || String(new Date().getMonth() + 1);
                      const dy = renewalAddDayRef.current?.value || "1";
                      const ids = renewalAddIdsRef.current?.value || "";
                      const assigned = renewalAddAssignedRef.current?.value || "";
                      const newItem = { id: crypto.randomUUID(), state: st, dueMonth: mo, dueDay: dy, identifiers: ids, assignedTo: assigned, frequency: "Yearly", comments: [] };
                      const updated = [...renewalItems, newItem];
                      setRenewalItems(updated);
                      setStateRenewal(true);
                      setAddingRenewal(false);
                      setLocalSvcs(prev => {
                        const targetKey = findRenewalService(prev)?.key || "annual_reports";
                        return prev.map((s: any) => s.key === targetKey ? { ...s, stateRenewalItems: updated, stateRenewal: true } : s);
                      });
                      syncRenewalItems(updated);
                    }}
                      style={{ all: "unset", cursor: "pointer", padding: "5px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: "var(--ink)", color: "#fff" }}>Add</button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setAddingRenewal(true)}
                  style={{
                    all: "unset", cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "8px 12px",
                    border: "1px dashed var(--line)", borderRadius: 8,
                    fontSize: 12, fontWeight: 600, color: "var(--teal)",
                    width: "100%", boxSizing: "border-box",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--teal)")}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--line)")}
                >
                  <span style={{ fontSize: 15, lineHeight: 1 }}>+</span> Add state
                </button>
              )}
            </div>
            );})()}

            {/* Month stage grid — for renditions/annual_reports module view */}
            {((resolvedKey === "renditions" || resolvedKey === "annual_reports") || moduleKey === "annual_reports") && targetSvc.enabled && (
              <div style={{ marginBottom: 12 }}>
                <div className="sect" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)", margin: "0 0 8px" }}>
                  Queue
                </div>
                {monthCells(resolvedKey)}
              </div>
            )}

            {/* Per-service assignee selector — skip for sales_tax and annual_reports (assigned at line-item level) */}
            {moduleKey !== "sales_tax" && moduleKey !== "annual_reports" && (
            <div style={{ marginBottom: 12 }}>
              <div className="sect" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)", margin: "0 0 8px" }}>
                Assigned To
              </div>
              <select className="ef" style={{ width: "100%", padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13, background: "#fff" }}
                value={resolvedAssignee}
                onChange={e => {
                  setESvcAssignees((prev: any) => ({ ...prev, [resolvedKey]: e.target.value }));
                  updateServicesAndAutoSave((svcs) => svcs.map((s: any) =>
                    s.key === resolvedKey ? { ...s, assignedTo: e.target.value } : s
                  ));
                }}
              >
                {profiles.map((m) => {
                  const displayName = firstName(m.name);
                  return <option key={m.id} value={m.name}>{displayName}</option>;
                })}
                <option>Unassigned</option>
              </select>
            </div>
            )}

            {/* Frequency/Cadence for non-payroll services */}
            {moduleKey !== "payroll" && resolvedKey !== "renditions" && targetSvc.enabled && (
              <div style={{ marginBottom: 12 }}>
                <div className="sect" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)", margin: "0 0 8px" }}>
                  Details
                </div>
                {/* Cadence for Financials only (1099s is always Annual) */}
                {moduleKey === "financials" && (
                  <div className="field" style={{ display: "flex", justifyContent: "flex-start", gap: 14, padding: "7px 0", fontSize: "13.5px", borderBottom: "1px dashed #e7e1d3" }}>
                    <span className="k" style={{ color: "var(--muted)" }}>Cadence</span>
                    <select style={{ flex: 1, textAlign: "left", padding: "4px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, background: "#fff", color: "var(--ink)", fontWeight: 500, outline: "none", cursor: "pointer" }}
                      value={(targetSvc.frequency || "Monthly") === "Yearly" || (targetSvc.frequency || "Monthly") === "yearly" || (targetSvc.frequency || "Monthly") === "annual" ? "Annual" : (targetSvc.frequency || "Monthly")} onChange={e => {
                        updateServicesAndAutoSave((svcs) => svcs.map((s: any) => s.key === moduleKey ? { ...s, frequency: e.target.value } : s));
                      }}>
                      <option value="Monthly">Monthly</option>
                      <option value="Quarterly">Quarterly</option>
                      <option value="Annual">Annual</option>
                      <option value="Semi-Monthly">Semi-Monthly</option>
                    </select>
                  </div>
                )}
                {/* Expected Annual for 1099s */}
                {moduleKey === "1099s" && (
                  <div className="field" style={{ display: "flex", justifyContent: "flex-start", gap: 14, padding: "7px 0", fontSize: "13.5px", borderBottom: "1px dashed #e7e1d3" }}>
                    <span className="k" style={{ color: "var(--muted)" }}>Expected Annual</span>
                    <input style={{ flex: 1, textAlign: "left", padding: "4px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, background: "#fff", color: "var(--ink)", fontWeight: 500, outline: "none" }}
                      type="number" defaultValue={targetSvc.expectedAnnual || 0} onBlur={e => { setLocalSvcs(prev => prev.map((s: any) => s.key === "1099s" ? { ...s, expectedAnnual: Number(e.target.value) } : s)); if (targetSvc?.csId) fetch("/api/clients",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({csId:targetSvc.csId,expectedAnnual:Number(e.target.value)})}).catch(()=>{}); }} placeholder="0" />
                  </div>
                )}
              </div>
            )}

            {/* Payroll: credentials section */}
            {moduleKey === "payroll" && targetSvc.enabled && (
              <>
                <div className="sect" style={sectStyle}>Payroll Details</div>
                <div className="field" style={{ display: "flex", justifyContent: "flex-start", gap: 14, padding: "7px 0", fontSize: "13.5px", borderBottom: "1px dashed #e7e1d3" }}>
                  <span className="k" style={{ color: "var(--muted)" }}>EIN</span>
                  <input
                    ref={eEinRef}
                    defaultValue={eEin}
                    onBlur={e => {
                      setEEin(e.target.value);
                      autoSave({ ...c, ein: e.target.value } as Client);
                    }}
                    placeholder="XX-XXXXXXX"
                    style={{ flex: 1, textAlign: "left", padding: "4px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, background: "#fff", color: "var(--ink)", fontWeight: 500, outline: "none", fontFamily: "var(--mono)" }}
                  />
                </div>
                <div className="field" style={{ display: "flex", justifyContent: "flex-start", gap: 14, padding: "7px 0", fontSize: "13.5px", borderBottom: "1px dashed #e7e1d3" }}>
                  <span className="k" style={{ color: "var(--muted)" }}>Frequency</span>
                  <select style={{ flex: 1, textAlign: "left", padding: "4px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, background: "#fff", color: "var(--ink)", fontWeight: 500, outline: "none", cursor: "pointer" }}
                    value={prPeriodFreq} onChange={e => {
                      const val = e.target.value;
                      setPrPeriodFreq(val);
                      // Recalculate start date based on new cadence + current pay day
                      const newStart = calcPayrollStartDate(val, prPaydate);
                      setLocalSvcs(prev => { const up = prev.map((s: any) => s.key === "payroll" ? { ...s, payPeriodFrequency: val, frequency: val, ...(newStart ? { pay_start_date: newStart } : {}) } : s); return up; });
                      if (newStart) setPrStartDate(newStart);
                      if (targetSvc?.csId) fetch("/api/clients",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({csId:targetSvc.csId,payPeriodFrequency:val,frequency:val,...(newStart?{pay_start_date:newStart}:{})})}).catch(()=>{});
                    }}>
                    <option value="">—</option>
                    <option value="Weekly">Weekly</option>
                    <option value="Bi-Weekly A">Bi-Weekly A</option>
                    <option value="Bi-Weekly B">Bi-Weekly B</option>
                    <option value="Semi-Monthly">Semi-Monthly</option>
                    <option value="Monthly">Monthly</option>
                    <option value="Quarterly">Quarterly</option>
                  </select>
                </div>
                <div className="field" style={{ display: "flex", justifyContent: "flex-start", gap: 14, padding: "7px 0", fontSize: "13.5px", borderBottom: "1px dashed #e7e1d3" }}>
                  <span className="k" style={{ color: "var(--muted)" }}>Pay Day</span>
                  <select style={{ flex: 1, textAlign: "left", padding: "4px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, background: "#fff", color: "var(--ink)", fontWeight: 500, outline: "none", cursor: "pointer" }}
                    value={prPaydate} onChange={e => {
                      const normalizedPayDay = normalizePayDay(e.target.value);
                      setPrPaydate(normalizedPayDay);
                      // Recalculate start date when pay day changes
                      const newStart = calcPayrollStartDate(prPeriodFreq, normalizedPayDay);
                      setLocalSvcs(prev => prev.map((s: any) => s.key === "payroll" ? { ...s, paydate: normalizedPayDay, ...(newStart ? { pay_start_date: newStart } : {}) } : s));
                      if (newStart) setPrStartDate(newStart);
                      if (targetSvc?.csId) fetch("/api/clients",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({csId:targetSvc.csId,paydate:normalizedPayDay,...(newStart?{pay_start_date:newStart}:{})})}).catch(()=>{});
                    }}>
                    <option value="">—</option>
                    {payDayOptions.includes(prPaydate) || !prPaydate ? null : <option value={prPaydate}>{prPaydate}</option>}
                    {payDayOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </div>
                <div className="field" style={{ display: "flex", justifyContent: "flex-start", gap: 14, padding: "7px 0", fontSize: "13.5px", borderBottom: "1px dashed #e7e1d3" }}>
                  <span className="k" style={{ color: "var(--muted)" }}>Start Date</span>
                  <input type="text" style={{ flex: 1, textAlign: "left", padding: "4px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, background: "var(--paper)", color: "var(--ink)", fontWeight: 500, outline: "none", cursor: "default" }}
                    value={prStartDate ? formatPayrollStartDate(prStartDate) : (prPeriodFreq && prPaydate ? formatPayrollStartDate(calcPayrollStartDate(prPeriodFreq, prPaydate)) : "")} readOnly />
                </div>
                <div className="field" style={{ display: "flex", justifyContent: "flex-start", gap: 14, padding: "7px 0", fontSize: "13.5px", borderBottom: "1px dashed #e7e1d3" }}>
                  <span className="k" style={{ color: "var(--muted)" }}>Processor</span>
                  <select style={{ flex: 1, textAlign: "left", padding: "4px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, background: "#fff", color: "var(--ink)", fontWeight: 500, outline: "none", cursor: "pointer" }}
                    value={targetSvc?.processor || ""} onChange={e => {
                      updateServicesAndAutoSave((svcs) => svcs.map((s: any) => s.key === "payroll" ? { ...s, processor: e.target.value } : s));
                    }}>
                    <option value="">—</option>
                    <option value="Quickbooks Desktop 24">Quickbooks Desktop 24</option>
                    <option value="Quickbooks Desktop">Quickbooks Desktop</option>
                    <option value="ADP">ADP</option>
                    <option value="QBO">QBO</option>
                  </select>
                </div>
                <div className="field" style={{ display: "flex", justifyContent: "flex-start", gap: 14, padding: "7px 0", fontSize: "13.5px", borderBottom: "1px dashed #e7e1d3" }}>
                  <span className="k" style={{ color: "var(--muted)" }}>EFTPS Password</span>
                  <div style={{ flex: 1, position: "relative" }}>
                    <input style={{ width: "100%", textAlign: "left", padding: "4px 30px 4px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, background: "#fff", color: "var(--ink)", fontWeight: 500, outline: "none", fontFamily: "var(--mono)" }}
                      type={showPrEftps ? "text" : "password"} ref={prEftpsRef} defaultValue={prEftps || ""}
                      onBlur={e => { setPrEftps(e.target.value); const p = localSvcs.find((s: any) => s.key === 'payroll'); if (p?.csId) fetch('/api/clients',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({csId:p.csId,eftps:e.target.value})}).catch(()=>{}); }} placeholder="—" />
                    <button type="button" tabIndex={-1}
                      onClick={() => setShowPrEftps(!showPrEftps)}
                      style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 4, color: "var(--muted)", fontSize: 15, lineHeight: 1 }}>
                      {showPrEftps ? (
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      )}
                    </button>
                  </div>
                </div>
                <div className="field" style={{ display: "flex", justifyContent: "flex-start", gap: 14, padding: "7px 0", fontSize: "13.5px", borderBottom: "1px dashed #e7e1d3" }}>
                  <span className="k" style={{ color: "var(--muted)" }}>PIN</span>
                  <div style={{ flex: 1, position: "relative" }}>
                    <input style={{ width: "100%", textAlign: "left", padding: "4px 30px 4px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, background: "#fff", color: "var(--ink)", fontWeight: 500, outline: "none", fontFamily: "var(--mono)" }}
                      type={showPrPin ? "text" : "password"} ref={prPinRef} defaultValue={prPin || ""}
                      onBlur={e => { setPrPin(e.target.value); const p = localSvcs.find((s: any) => s.key === 'payroll'); if (p?.csId) fetch('/api/clients',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({csId:p.csId,payrollPassword:e.target.value})}).catch(()=>{}); }} placeholder="—" />
                    <button type="button" tabIndex={-1}
                      onClick={() => setShowPrPin(!showPrPin)}
                      style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 4, color: "var(--muted)", fontSize: 15, lineHeight: 1 }}>
                      {showPrPin ? (
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      )}
                    </button>
                  </div>
                </div>
                <div className="field" style={{ display: "flex", justifyContent: "flex-start", gap: 14, padding: "7px 0", fontSize: "13.5px", borderBottom: "1px dashed #e7e1d3" }}>
                  <span className="k" style={{ color: "var(--muted)" }}>Payroll email</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
                      {prEmails.filter(Boolean).map((em, i) => (
                        <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "var(--blue-soft)", borderRadius: 6, padding: "2px 8px", fontSize: 12, fontWeight: 500 }}>
                          {em}
                          <button onClick={() => { const upd = prEmails.filter((_, j) => j !== i); setPrEmails(upd); setLocalSvcs(prev => prev.map((s: any) => s.key === "payroll" ? { ...s, payEmails: upd } : s)); const p2 = localSvcs.find((s: any) => s.key === "payroll"); if (p2?.csId) fetch("/api/clients",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({csId:p2.csId,payEmails:upd})}).catch(()=>{}); }}
                            style={{ all: "unset", cursor: "pointer", color: "var(--red)", fontSize: 12, lineHeight: 1 }}>×</button>
                        </span>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>
                    <input style={{ flex: 1, padding: "4px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12, background: "#fff", outline: "none", boxSizing: "border-box" }}
                      ref={newPrEmailRef}
                      defaultValue={newPrEmail}
                      onBlur={e => setNewPrEmail(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") addPrEmail(); }}
                      placeholder="Type email + Enter"
                    />
                    <button className="reveal"
                      onClick={addPrEmail}
                      style={{ all: "unset", cursor: "pointer", padding: "4px 9px", background: "var(--ink)", color: "#fff", borderRadius: 6, fontSize: 14, fontWeight: 700, lineHeight: 1 }}>+</button>
                    </div>
                </div>
                </div>
                <div className="field" style={{ display: "flex", justifyContent: "flex-start", gap: 14, padding: "7px 0", fontSize: "13.5px", borderBottom: "1px dashed #e7e1d3" }}>
                  <span className="k" style={{ color: "var(--muted)" }}>Notes</span>
                  <textarea style={{ flex: 1, textAlign: "left", padding: "4px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, background: "#fff", color: "var(--ink)", fontWeight: 500, outline: "none", minHeight: 50, resize: "vertical" }}
                    ref={reportingRef}
                    defaultValue={prReportingNotes}
                    onBlur={e => { setPrReportingNotes(e.target.value); const p = localSvcs.find((s: any) => s.key === 'payroll'); if (p?.csId) fetch('/api/clients',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({csId:p.csId,reportingNotes:e.target.value})}).catch(()=>{}); }}
                    placeholder="Add payroll notes..." />
                </div>
              </>
            )}

            {/* Tax return details */}
            {moduleKey === "tax_returns" && targetSvc.enabled && (
              <>
                <div className="sect" style={sectStyle}>Tax Return Details</div>
                <div className="field" style={{ display: "flex", justifyContent: "flex-start", gap: 14, padding: "7px 0", fontSize: "13.5px", borderBottom: "1px dashed #e7e1d3" }}>
                  <span className="k" style={{ color: "var(--muted)" }}>Filing Type</span>
                  <select value={filingType} onChange={e => {
                    setFilingType(e.target.value);
                    updateServicesAndAutoSave((svcs) => svcs.map((s: any) => s.key === "tax_returns" ? { ...s, filingType: e.target.value } : s));
                  }}
                    style={{ flex: 1, textAlign: "left", padding: "4px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, background: "#fff", color: "var(--ink)", fontWeight: 500, outline: "none" }}>
                    <option value="">—</option>
                    {FILING_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div className="field" style={{ display: "flex", justifyContent: "flex-start", gap: 14, padding: "7px 0", fontSize: "13.5px", borderBottom: "1px dashed #e7e1d3" }}>
                  <span className="k" style={{ color: "var(--muted)" }}>Filing State</span>
                  <select value={filingState} onChange={e => {
                    setFilingState(e.target.value);
                    updateServicesAndAutoSave((svcs) => svcs.map((s: any) => s.key === "tax_returns" ? { ...s, filingState: e.target.value } : s));
                  }}
                    style={{ flex: 1, textAlign: "left", padding: "4px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, background: "#fff", color: "var(--ink)", fontWeight: 500, outline: "none" }}>
                    <option value="">—</option>
                    {US_STATES.map(st => <option key={st}>{st}</option>)}
                  </select>
                </div>
                <div className="field" style={{ display: "flex", justifyContent: "flex-start", gap: 14, padding: "7px 0", fontSize: "13.5px", borderBottom: "1px dashed #e7e1d3" }}>
                  <span className="k" style={{ color: "var(--muted)" }}>Filing Month</span>
                  <select value={filingMonth} onChange={e => {
                    setFilingMonth(e.target.value);
                    updateServicesAndAutoSave((svcs) => svcs.map((s: any) => s.key === "tax_returns" ? { ...s, filingMonth: e.target.value } : s));
                  }}
                    style={{ flex: 1, textAlign: "left", padding: "4px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, background: "#fff", color: "var(--ink)", fontWeight: 500, outline: "none" }}>
                    <option value="">—</option>
                    {MONTH_NAMES.map((m, i) => <option key={i} value={String(i + 1)}>{m}</option>)}
                  </select>
                </div>
              </>
            )}

            {/* Sales Tax: line items section — only on Sales Tax tab */}
            {/* Service Name — only show in full client view, not on worklist tabs */}
            {!moduleKey && (
            <div style={{ marginBottom: 12, padding: "10px 12px", background: "var(--grey-soft,#f5f5f5)", borderRadius: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>Service Name</span>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)", marginTop: 3 }}>{targetSvc.serviceName || targetSvc.label}</div>
            </div>
            )}
            {targetSvc.key === "sales_tax" && targetSvc.enabled && <SalesTaxLineItemsSection />}

            {/* Service notes from DB — hidden */}

            {/* Notes section — hidden on Sales Tax and Annual Reports tabs (notes are per-line-item) */}
            {moduleKey !== "sales_tax" && moduleKey !== "annual_reports" && (
            <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
              <div className="notemo">Notes for {svcLabel(moduleKey)}</div>
              <div className="noteadd">
                <select value={notesMonth} onChange={e => setNotesMonth(Number(e.target.value))}
                  style={{ padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13, background: "var(--paper)", color: "var(--ink)" }}>
                  {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
                </select>
                <select value={noteType} onChange={e => setNoteType(e.target.value)}
                  style={{ padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13, background: "var(--paper)", color: "var(--ink)" }}>
                  {NOTE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <input value={notesText} onChange={e => setNotesText(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAddNoteForModule(); } }}
                  placeholder="Add a note..." style={{ flex: 1, padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13, background: "var(--paper)", color: "var(--ink)", outline: "none" }} />
                <button onClick={handleAddNoteForModule}
                  style={{ all: "unset", cursor: "pointer", background: "var(--teal)", color: "#fff", padding: "8px 16px", borderRadius: 8, fontWeight: 600, fontSize: 13, whiteSpace: "nowrap" }}>
                  Add
                </button>
              </div>
              <div style={{ marginTop: 10 }}>
                {(() => {
                  const svc = localSvcs.find((s: any) => s.key === resolvedKey);
                  const allComments = (svc?.comments || []).sort((a: CommentEntry, b: CommentEntry) => a.month - b.month);
                  const PER_PAGE = 3;
                  const totalPages = Math.ceil(allComments.length / PER_PAGE);
                  const pageComments = allComments.slice(notePage * PER_PAGE, (notePage + 1) * PER_PAGE);
                  return allComments.length > 0 ? (
                    <div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: totalPages > 1 ? 8 : 0 }}>
                        {pageComments.map((cm: CommentEntry) => (
                          <div key={cm.id} className="note">
                            <div className="ntxt">{cm.text}</div>
                            <div className="nmeta">{MONTHS[cm.month]} · {cm.author} · {new Date(cm.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
                            <button onClick={() => deleteComment(resolvedKey, cm.id)}
                              style={{ all: "unset", cursor: "pointer", color: "var(--red)", fontSize: 11, marginTop: 4, display: "block" }}>
                              × Delete
                            </button>
                          </div>
                        ))}
                      </div>
                      {totalPages > 1 && (
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 12 }}>
                          <button onClick={() => setNotePage(p => Math.max(0, p - 1))} disabled={notePage === 0}
                            style={{ all: "unset", cursor: notePage === 0 ? "default" : "pointer", padding: "3px 8px", borderRadius: 5, border: "1px solid var(--line)", color: notePage === 0 ? "var(--muted)" : "var(--ink)", fontSize: 11, opacity: notePage === 0 ? 0.4 : 1 }}>
                            ← Prev
                          </button>
                          <span style={{ color: "var(--muted)", fontWeight: 500 }}>{notePage + 1} / {totalPages}</span>
                          <button onClick={() => setNotePage(p => Math.min(totalPages - 1, p + 1))} disabled={notePage >= totalPages - 1}
                            style={{ all: "unset", cursor: notePage >= totalPages - 1 ? "default" : "pointer", padding: "3px 8px", borderRadius: 5, border: "1px solid var(--line)", color: notePage >= totalPages - 1 ? "var(--muted)" : "var(--ink)", fontSize: 11, opacity: notePage >= totalPages - 1 ? 0.4 : 1 }}>
                            Next →
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12.5, color: "var(--muted)", fontStyle: "italic" }}>No notes yet.</div>
                  );
                })()}
              </div>
            </div>
            )}
          </div>

          {/* Footer */}
          <div className="ofoot" style={{ padding: "14px 24px", borderTop: "1px solid var(--line)", background: "var(--card)", display: "flex", gap: 10, alignItems: "center" }}>
            <button onClick={toggleActive} style={{
              all: "unset", cursor: "pointer", fontWeight: 600, fontSize: "13.5px",
              padding: "10px 14px", borderRadius: 11,
              background: isActive ? "var(--red-soft,#fce8e6)" : "var(--green-soft,#e6f4ea)",
              color: isActive ? "var(--red,#c62828)" : "var(--green,#1e7e34)",
              border: `1px solid ${isActive ? "var(--red-soft,#fce8e6)" : "var(--green-soft,#c8e6c9)"}`,
            }}>
              {isActive ? "Deactivate client" : "Activate client"}
            </button>
            <div style={{ flex: 1 }}></div>
            <button className="btn alt" onClick={() => { syncAndAutoSaveModule(); flushSave(); onClose(); }} style={{
              all: "unset", cursor: "pointer", background: "var(--card)", color: "var(--ink)",
              border: "1px solid var(--line)", padding: "10px 16px", borderRadius: 11,
              fontWeight: 600, fontSize: "13.5px", display: "inline-flex", gap: 7, alignItems: "center",
            }}>
              Done
            </button>
          </div>
        </div>
      </>
    );
  }

  // ══════════════════════════════════════════════════════════════
  // UNIVERSAL DETAIL VIEW (shows fields with edit toggle)
  // ══════════════════════════════════════════════════════════════
  if (!moduleKey) {
    const prSvc = localSvcs.find((s: any) => s.key === "payroll");

    function syncAndAutoSaveUniversal() {
      const updatedSvcs = localSvcs.map((s: any) => {
        let updated = s;
        if (s.key === "payroll") {
          updated = { ...updated, paydate: prPaydate, pay_start_date: prStartDate, payrollPassword: prPinRef.current?.value ?? prPin, eftps: prEftpsRef.current?.value ?? prEftps, payEmails: prEmails, payPeriodFrequency: prPeriodFreq, frequency: prPeriodFreq, reportingMethod: prReportingMethod, payrollCategory: prPayrollCategory, qbLicense: prQbLicense, reportingNotes: reportingRef.current?.value ?? prReportingNotes };
        }
        if (s.key === "tax_returns") {
          updated = { ...updated, filingState, filingMonth, filingType };
        }
        return updated;
      });
      autoSave({
        ...c,
        active: isActive,
        name: eName,
        type: eType as "Business" | "Personal",
        group: eGroup,
        contact: eContact,
        emails: [...new Set([eEmailRef.current?.value ?? eEmail, eAddEmailRef.current?.value ?? eAddEmail].filter(Boolean))],
        phones: [ePhoneRef.current?.value ?? ePhone, eAddPhoneRef.current?.value ?? eAddPhone].filter(Boolean),
        address: eAddressRef.current?.value ?? eAddress, city: eCityRef.current?.value ?? eCity, state: eStateRef.current?.value ?? eState, zip: eZipRef.current?.value ?? eZip,
        ein: eEinRef.current?.value ?? eEin,
        notes: eNotesRef.current?.value ?? eNotes,
        assignedStaff: eAssigned,
        services: updatedSvcs,
      } as Client);
    }

    // ── Inject Annual Reports as a synthetic service derived from Renditions ──
    const hasAnnual = localSvcs.some((s: any) => s.key === "annual_reports");
    const displaySvcs = hasAnnual ? localSvcs : (() => {
      const rend = localSvcs.find((s: any) => s.key === "renditions");
      if (!rend) return localSvcs;
      const annualSvc = {
        key: "annual_reports",
        label: "Annual Reports",
        enabled: !!(rend.stateRenewal || (rend.stateRenewalItems?.length > 0)),
        stateRenewal: rend.stateRenewal || false,
        stateRenewalItems: rend.stateRenewalItems || [],
        assignedTo: (rend.stateRenewalItems || [])[0]?.assignedTo || "",
        frequency: "Yearly",
        months: rend.months || [],
        csId: rend.csId,
      };
      return [...localSvcs, annualSvc];
    })();

    return (
      <>
        <div className="scrim show" onClick={() => { syncAndAutoSaveUniversal(); flushSave(); onClose(); }} />
        <div className="over show" style={{
          background: "var(--paper)", boxShadow: "-12px 0 40px rgba(33,31,26,.18)",
        }}>
          {/* Header */}
          <div className="ohead" style={{
            padding: "22px 24px 16px", borderBottom: "1px solid var(--line)", background: "var(--card)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
              <div>
                <div className="nm" style={{ fontFamily: '"Fraunces",Georgia,serif', fontWeight: 600, fontSize: 23, lineHeight: 1.12 }}>{c.name}</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3, display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <span>📁 {(c.groupName || c.group) && (c.groupName || c.group).toLowerCase() !== "unassigned" ? (c.groupName || c.group) : "—"}</span>
                  <span>👤 {c.contact || "—"}</span>
                </div>
              </div>
              <button className="ox" onClick={() => { syncAndAutoSaveUniversal(); flushSave(); onClose(); }} style={{ all: "unset", cursor: "pointer", fontSize: 22, color: "var(--muted)", lineHeight: 1 }}>×</button>
            </div>
          </div>

          {/* Body */}
          <div className="obody" ref={bodyRef} onScroll={saveScroll} style={{ overflowY: "auto", padding: "20px 24px 30px", flex: 1 }}>
            <fieldset disabled={!canEditClientData} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div className="sect" style={{ marginTop: 0, fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 10 }}>
                Details
              </div>
            </div>

            {/* Company/client name */}
            <div className="field" style={fieldStyle}>
              <span className="k" style={{ color: "var(--muted)" }}>Company name</span>
              <input style={{ flex: 1, textAlign: "left", padding: "4px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, background: "#fff", color: "var(--ink)", fontWeight: 500, outline: "none" }}
                value={eName} onChange={e => setEName(e.target.value)} onBlur={e => { const name = e.target.value.trim(); if (name) { setEName(name); syncAndAutoSaveUniversal(); } else { setEName(client.name); } }} placeholder="Company name" />
            </div>
            {/* Group */}
            <div className="field" style={fieldStyle}>
              <span className="k" style={{ color: "var(--muted)" }}>Group</span>
              <input style={{ flex: 1, textAlign: "left", padding: "4px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, background: "#fff", color: "var(--ink)", fontWeight: 500, outline: "none" }}
                value={eGroup} onChange={e => setEGroup(e.target.value)} onBlur={syncAndAutoSaveUniversal} placeholder="—" />
            </div>
            {/* Contact */}
            <div className="field" style={fieldStyle}>
              <span className="k" style={{ color: "var(--muted)" }}>Contact</span>
              <input style={{ flex: 1, textAlign: "left", padding: "4px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, background: "#fff", color: "var(--ink)", fontWeight: 500, outline: "none" }}
                value={eContact} onChange={e => setEContact(e.target.value)} onBlur={syncAndAutoSaveUniversal} placeholder="—" />
            </div>

            {/* Email */}
            <div className="field" style={fieldStyle}>
              <span className="k" style={{ color: "var(--muted)" }}>Email</span>
              <input style={{ flex: 1, textAlign: "left", padding: "4px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, background: "#fff", color: "var(--ink)", fontWeight: 500, outline: "none" }}
                ref={eEmailRef} defaultValue={eEmail} onBlur={e => { setEEmail(e.target.value); syncAndAutoSaveUniversal(); }} placeholder="—" />
            </div>
            {/* Additional email */}
            <div className="field" style={fieldStyle}>
              <span className="k" style={{ color: "var(--muted)" }}>Additional email</span>
              <input style={{ flex: 1, textAlign: "left", padding: "4px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, background: "#fff", color: "var(--ink)", fontWeight: 500, outline: "none" }}
                ref={eAddEmailRef} defaultValue={eAddEmail} onBlur={e => { setEAddEmail(e.target.value); syncAndAutoSaveUniversal(); }} placeholder="—" />
            </div>
            {/* Phone */}
            <div className="field" style={fieldStyle}>
              <span className="k" style={{ color: "var(--muted)" }}>Phone</span>
              <input style={{ flex: 1, textAlign: "left", padding: "4px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, background: "#fff", color: "var(--ink)", fontWeight: 500, outline: "none", borderColor: isInvalidPhone(ePhoneRef.current?.value ?? ePhone) ? "var(--red,#e74c3c)" : undefined }}
                ref={ePhoneRef} defaultValue={ePhone} onBlur={e => { setEPhone(normalizePhone(e.target.value)); syncAndAutoSaveUniversal(); }} placeholder="—" />
            </div>
            {isInvalidPhone(ePhoneRef.current?.value ?? ePhone) && <div style={{ color: "var(--red,#e74c3c)", fontSize: 12, marginTop: -10, marginBottom: 8 }}>Enter a valid 10-digit phone number.</div>}
            {/* Additional phone */}
            <div className="field" style={fieldStyle}>
              <span className="k" style={{ color: "var(--muted)" }}>Additional phone</span>
              <input style={{ flex: 1, textAlign: "left", padding: "4px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, background: "#fff", color: "var(--ink)", fontWeight: 500, outline: "none", borderColor: isInvalidPhone(eAddPhoneRef.current?.value ?? eAddPhone) ? "var(--red,#e74c3c)" : undefined }}
                ref={eAddPhoneRef} defaultValue={eAddPhone} onBlur={e => { setEAddPhone(normalizePhone(e.target.value)); syncAndAutoSaveUniversal(); }} placeholder="—" />
            </div>
            {isInvalidPhone(eAddPhoneRef.current?.value ?? eAddPhone) && <div style={{ color: "var(--red,#e74c3c)", fontSize: 12, marginTop: -10, marginBottom: 8 }}>Enter a valid 10-digit phone number.</div>}

            {/* Address */}
            <div className="field" style={fieldStyle}>
              <span className="k" style={{ color: "var(--muted)" }}>Address</span>
              <input style={{ flex: 1, textAlign: "left", padding: "4px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, background: "#fff", color: "var(--ink)", fontWeight: 500, outline: "none" }}
                ref={eAddressRef} defaultValue={eAddress} onBlur={e => { setEAddress(e.target.value); syncAndAutoSaveUniversal(); }} placeholder="—" />
            </div>

            {/* City / State / ZIP row */}
            <div style={{ display: "flex", gap: 10 }}>
              <div className="field" style={{ ...fieldStyle, flex: 1, minWidth: 0 }}>
                <span className="k" style={{ color: "var(--muted)", flexShrink: 0 }}>City</span>
                <input style={{ flex: 1, minWidth: 0, textAlign: "left", padding: "4px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, background: "#fff", color: "var(--ink)", fontWeight: 500, outline: "none" }}
                  ref={eCityRef} defaultValue={eCity} onBlur={e => { setECity(e.target.value); syncAndAutoSaveUniversal(); }} placeholder="—" />
              </div>
              <div className="field" style={{ ...fieldStyle, flex: "0 0 70px" }}>
                <span className="k" style={{ color: "var(--muted)", flexShrink: 0 }}>State</span>
                <input style={{ width: 70, minWidth: 70, textAlign: "left", padding: "4px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, background: "#fff", color: "var(--ink)", fontWeight: 500, outline: "none" }}
                  ref={eStateRef} defaultValue={eState} onBlur={e => { setEState(e.target.value); syncAndAutoSaveUniversal(); }} placeholder="—" />
              </div>
              <div className="field" style={{ ...fieldStyle, flex: "0 0 120px" }}>
                <span className="k" style={{ color: "var(--muted)", flexShrink: 0 }}>ZIP</span>
                <input type="text" inputMode="numeric" pattern="[0-9]*" style={{ width: 120, minWidth: 120, textAlign: "left", padding: "4px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, background: "#fff", color: "var(--ink)", fontWeight: 500, outline: "none" }}
                  ref={eZipRef} defaultValue={String(eZip).replace(/\.0+$/, "")} onBlur={e => { setEZip(e.target.value.replace(/\D/g, "")); syncAndAutoSaveUniversal(); }} placeholder="—" />
              </div>
            </div>

            {/* General Notes */}
            <div className="field" style={fieldStyle}>
              <span className="k" style={{ color: "var(--muted)" }}>General Notes</span>
              <textarea
                ref={eNotesRef}
                defaultValue={eNotes}
                onBlur={e => { setENotes(e.target.value); syncAndAutoSaveUniversal(); }}
                placeholder="—"
                style={{
                  flex: 1,
                  minWidth: 0,
                  minHeight: 60,
                  maxHeight: 300,
                  resize: "vertical",
                  padding: "8px 10px",
                  border: "1px solid var(--line)",
                  borderRadius: 6,
                  fontSize: 13,
                  background: "#fff",
                  color: "var(--ink)",
                  fontWeight: 500,
                  outline: "none",
                  fontFamily: "inherit",
                  lineHeight: 1.4,
                }}
              />
            </div>

            {/* ── Services ── */}
            <div style={{ marginTop: 20 }}>
              <div className="sect" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)", margin: "0 0 10px" }}>
                Services
              </div>
              {displaySvcs.map((svc: any) => (
                <SingleServiceCard key={svc.key} svc={svc} />
              ))}
            </div>
            </fieldset>

          </div>

          {/* Footer */}
          <div className="ofoot" style={{ padding: "14px 24px", borderTop: "1px solid var(--line)", background: "var(--card)", display: "flex", gap: 10, alignItems: "center" }}>
            <button onClick={toggleActive} style={{
              all: "unset", cursor: "pointer", fontWeight: 600, fontSize: "13.5px",
              padding: "10px 14px", borderRadius: 11,
              background: isActive ? "var(--red-soft,#fce8e6)" : "var(--green-soft,#e6f4ea)",
              color: isActive ? "var(--red,#c62828)" : "var(--green,#1e7e34)",
              border: `1px solid ${isActive ? "var(--red-soft,#fce8e6)" : "var(--green-soft,#c8e6c9)"}`,
            }}>
              {isActive ? "Deactivate client" : "Activate client"}
            </button>
            <div style={{ flex: 1 }}></div>
            <button onClick={() => { syncAndAutoSaveUniversal(); flushSave(); onClose(); }} style={{
              all: "unset", cursor: "pointer", background: "var(--card)", color: "var(--ink)",
              border: "1px solid var(--line)", padding: "10px 16px", borderRadius: 11,
              fontWeight: 600, fontSize: "13.5px",
            }}>
              Done
            </button>
          </div>
        </div>
      </>
    );
  }
}

// ── Shared styles ──
const fieldStyle: React.CSSProperties = {
  display: "flex", justifyContent: "flex-start", gap: 14,
  padding: "7px 0", fontSize: "13.5px", borderBottom: "1px dashed #e7e1d3",
};
const sectStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
  color: "var(--muted)", margin: "22px 0 10px",
};
const elStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase",
  color: "var(--muted)", margin: "12px 0 4px", display: "block",
};
const efStyle: React.CSSProperties = {
  width: "100%", padding: "9px 11px", border: "1px solid var(--line)", borderRadius: 9,
  font: "inherit", fontSize: 14, background: "#fff", marginBottom: 4,
};
