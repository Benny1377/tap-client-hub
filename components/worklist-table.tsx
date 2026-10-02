"use client";

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { formatPayrollStartDate, getPayrollStartDate } from "@/lib/payroll-schedule";
import { COMMENT_CATEGORIES, normalizeCommentCategory, type CommentCategory } from "@/lib/comment-category";

import type { Client, ServiceConfig, ServiceKey, MonthStatus } from "@/lib/types";
import { MONTHS_SHORT } from "@/lib/data";
import { filterWorklistKpi, type WorklistKpi } from "@/lib/worklist-kpi-filter";
import { collectAssignmentOptions, matchesAssignmentFilter } from "@/lib/worklist-assignment-filter";
import { exportClientCsv, serviceLabel } from "@/lib/export-csv";


// ── Worklist stage types ──
export type WorklistStage = "" | "ip" | "wc" | "pp" | "dl" | "dn" | "na";

const STAGE_LABELS: Record<WorklistStage, string> = {
  "": "Not Started",
  ip: "In Progress",
  wc: "Waiting on Client",
  pp: "Prepared",
  dl: "Delayed",
  dn: "Done",
  na: "N/A",
};

// Variant-aware stage label — tax_returns uses "Filed" instead of "Done"
function getStageLabel(stage: WorklistStage, variant?: string): string {
  if (variant === "tax_returns" && stage === "dn") return "Filed";
  return STAGE_LABELS[stage];
}

// ── Stage colors (matching demo v7 mcell classes exactly) ──
const PAYROLL_PROCESSOR_OPTIONS = ["ADP", "QBO", "Quickbooks Desktop", "Quickbooks Desktop 24"];

const BIWEEKLY_CODES = ["", "1 - ODD", "2 - EVEN"];
const PAY_PERIOD_FREQ = ["", "Monthly", "Semi-Monthly", "Bi-Weekly A", "Bi-Weekly B", "Quarterly"];
const REPORTING_METHODS = ["", "PR Reports only", "Email Paystub to Client", "Log into Client"];
const PAYROLL_CATEGORIES = ["", "Monthly", "Salary", "SAME", "Right Network", "Tushar"];
const PAYDAY_OPTIONS = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  "EOM", "15th & EOM", "5th/20th", "1st & 15th",
] as const;

// Payday options grouped by cadence for smart dropdown filtering
const PAYDAY_BY_CADENCE: Record<string, string[]> = {
  "Weekly":       ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"],
  "Bi-Weekly A":  ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"],
  "Bi-Weekly B":  ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"],
  "Bi-Weekly":    ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"],
  "Semi-Monthly": ["1st & 15th","15th & EOM","5th/20th"],
  "Monthly":      ["EOM","1st","5th","10th","15th","20th","25th","28th"],
  "Quarterly":    ["EOM","1st","5th","10th","15th","20th","25th","28th"],
} as const;
const FILING_TYPES = ["C Corp.", "S Corp.", "Partnership", "SMLLC", "Personal", "Trust", "Non Profit", "Retirem Plan"];
const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];
// prog=blue, wait=amber, prep=teal, done=green, na=red, lock=not due
const STAGE_STYLES: Record<
  WorklistStage,
  { bg: string; fg: string; border: string; cls: string; label: string }
> = {
  "": { bg: "transparent", fg: "#c2c8d4", border: "transparent", cls: "lock", label: "Not due" },
  ip: { bg: "var(--blue-soft)", fg: "var(--blue)", border: "#bcd0e2", cls: "prog", label: "In progress" },
  wc: { bg: "var(--amber-soft)", fg: "var(--amber)", border: "#e8d3a6", cls: "wait", label: "Waiting on client" },
  pp: { bg: "var(--teal-soft)", fg: "var(--teal-ink)", border: "#c5d0ec", cls: "prep", label: "Prepared" },
  dl: { bg: "var(--red-soft)", fg: "var(--red)", border: "#e8c4bf", cls: "delay", label: "Delayed" },
  dn: { bg: "var(--green-soft)", fg: "var(--green)", border: "#bcdcc6", cls: "done", label: "Done" },
  na: { bg: "var(--red-soft)", fg: "var(--red)", border: "#e8c4bf", cls: "na", label: "N/A" },
};
const STAGE_CYCLE: WorklistStage[] = ["", "ip", "wc", "pp", "dl", "dn", "na"];

// Single-click cycling: advances to next stage, wraps from na back to blank
function nextStage(current: WorklistStage): WorklistStage {
  const cycle: WorklistStage[] = ["", "ip", "wc", "pp", "dl", "dn", "na"];
  const idx = cycle.indexOf(current);
  return cycle[(idx + 1) % cycle.length];
}

// ── Map existing MonthStatus → WorklistStage ──
function mapMonthStatus(status: MonthStatus): WorklistStage {
  switch (status) {
    case "done":
    case "paid":
      return "dn";
    case "billed":
      return "pp";
    case "delayed":
      return "dl";
    case "na":
      return "na";
    case "in_progress":
      return "ip";
    case "waiting":
      return "wc";
    case "lock":
    default:
      return "";
  }
}

// ── Active months by frequency ──
function getActiveMonths(
  frequency: ServiceConfig["frequency"],
  startMonth?: number,
): Set<number> {
  const f = (frequency || "").toLowerCase();
  switch (f) {
    case "monthly":
    case "weekly":
    case "bi-weekly":
    case "bi-weekly a":
    case "bi-weekly b":
    case "semi-monthly": {
      // If a start month is set, only mark months from start onwards as active
      if (startMonth !== undefined && startMonth >= 0) {
        const s = new Set<number>();
        for (let m = startMonth; m < 12; m++) s.add(m);
        return s;
      }
      return new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    }
    case "quarterly": {
      const s = startMonth ?? 0; // default Jan
      return new Set([s % 12, (s + 3) % 12, (s + 6) % 12, (s + 9) % 12]);
    }
    case "annually":
    case "yearly":
    case "annual":
      return new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]); // All months — yearly services can have work done in any month
    default:
      return new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]); // Default to all months active
  }
}

// ── Payroll: max runs per month by cadence ──
type PayrollCadence = "Weekly" | "Bi-Weekly" | "Bi-Weekly A" | "Bi-Weekly B" | "Semi-Monthly" | "Monthly";

// Payroll frequency values have historically arrived from imports in several
// spellings. Keep the filter comparison on one canonical display value.
function normalizePayrollCadence(value: unknown): PayrollCadence {
  const normalized = String(value || "").trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (normalized === "weekly") return "Weekly";
  if (normalized === "bi-weekly" || normalized === "biweekly") return "Bi-Weekly A";
  if (normalized === "bi-weekly-a" || normalized === "biweekly-a") return "Bi-Weekly A";
  if (normalized === "bi-weekly-b" || normalized === "biweekly-b") return "Bi-Weekly B";
  if (normalized === "semi-monthly" || normalized === "semimonthly") return "Semi-Monthly";
  if (normalized === "monthly") return "Monthly";
  return "Monthly";
}

function getMaxRunsPerMonth(cadence: PayrollCadence): number {
  switch (cadence) {
    case "Weekly":   return 5;
    case "Bi-Weekly":
    case "Bi-Weekly A":
    case "Bi-Weekly B": return 2;
    case "Semi-Monthly": return 2;
    case "Monthly":  return 1;
  }
}

// ── Payroll: calculate next processing date from cadence + payStartDate ──
function getNextProcessingDate(cadence: PayrollCadence, payStartDate?: string): string {
  if (!payStartDate) return "·";
  const now = new Date();
  // The active month cell displays the calculated start date as MM/DD.
  // Normalize: strip year prefix if ISO format "2026-01-15" → "01/15"
  let normalized = payStartDate;
  const isoMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) normalized = `${isoMatch[2]}/${isoMatch[3]}`;
  // Also strip trailing year: "01/15/2026" → "01/15"
  normalized = normalized.replace(/\/\d{4}$/, "");
  const [sm, sd] = normalized.split("/").map(Number);
  if (isNaN(sm) || isNaN(sd) || sm < 1 || sm > 12 || sd < 1 || sd > 31) return normalized;

  if (cadence === "Monthly") {
    // Next month starting from the day-of-month in payStartDate
    let m = now.getMonth() + 1; // 0-indexed → 1-indexed
    let y = now.getFullYear();
    if (now.getDate() >= sd) m++; // already past this month's date
    if (m > 11) { m = 0; y++; }
    return `${m + 1}/${sd}`;
  }

  if (cadence === "Weekly") {
    // Next occurrence of the day-of-week matching payStartDate's day-of-week interpretation
    // We'll treat sd as a day-of-week indicator or just find next week
    const dayOfWeek = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][now.getDay()];
    // For simplicity, show "Next week" or compute precisely
    const next = new Date(now);
    next.setDate(now.getDate() + (7 - now.getDay())); // next Monday
    return `${next.getMonth() + 1}/${next.getDate()}`;
  }

  // Bi-Weekly: find next date based on start date
  const startDate = new Date(now.getFullYear(), sm - 1, sd);
  let next = new Date(startDate);
  while (next <= now) {
    next.setDate(next.getDate() + 14);
  }
  return `${next.getMonth() + 1}/${next.getDate()}`;
}

// ── 1099 expected counts — use real client_services.expected_annual
export function getT9ExpectedCount(clientId: string, svc?: any): number {
  if (svc?.expectedAnnual && svc.expectedAnnual > 0) return svc.expectedAnnual;
  return 0;
}

// ══════════════════════════════════════════════
// ── Worklist Table Component ──
// ══════════════════════════════════════════════

// ── Map WorklistStage → MonthStatus for persistence ──
export function stageToMonthStatus(stage: WorklistStage): MonthStatus {
  switch (stage) {
    case "dn":
      return "done";
    case "pp":
      return "billed";
    case "dl":
      return "delayed";
    case "":
      return "lock";
    case "na":
      return "na";
    case "ip":
      return "in_progress";
    case "wc":
      return "waiting";
    default:
      return "lock";
  }
}

export interface WorklistTableProps {
  serviceKey: ServiceKey;
  clients: any[];
  year: number;
  variant?: "default" | "payroll" | "t9" | "tax_returns";
  readOnly?: boolean;
  loading?: boolean;
  showRenewalColumns?: boolean;
  onStageChange?: (clientId: string, monthIdx: number, stage: WorklistStage, csId?: string) => void;
  onClientClick?: (clientId: string) => void;
  onPayrollMissingRuns?: (count: number) => void;
  onDataChange?: () => void;
}

// ── Build initial worklist state from clients ──
function buildWorklistState(clients: any[], serviceKey: ServiceKey): Record<string, WorklistStage[]> {
  const state: Record<string, WorklistStage[]> = {};
  for (const client of clients) {
    const svc = client.services.find((s: any) => s.key === serviceKey);
    if (!svc?.enabled) continue;
    const key = `${client.id}:${serviceKey}`;
    const raw = (svc.months as any[]) || [];
    state[key] = raw.map((m, idx) => {
      // Payroll: mark months 0-4 (Jan-May) as done, respect existing non-empty values
      if (serviceKey === "payroll" && idx <= 4) {
        const existing = mapMonthStatus(m);
        return existing === "" || existing === undefined || existing === null ? "dn" : existing;
      }
      return mapMonthStatus(m);
    });
  }
  return state;
}

export default function WorklistTable({
  serviceKey,
  clients,
  year,
  variant = "default",
  readOnly = false,
  loading = false,
  showRenewalColumns = false,
  onStageChange,
  onClientClick,
  onPayrollMissingRuns,
  onDataChange,
}: WorklistTableProps) {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();
  const isHistorical = year < currentYear;

  // ── Filter clients with this service enabled ──
  const serviceClients = useMemo(
    () =>
      clients.filter((c) => {
        const svc = c.services.find((s) => s.key === serviceKey);
        return svc?.enabled;
      }),
    [clients, serviceKey],
  );

  // ── Filter clients with this service enabled ──
  const [search, setSearch] = useState("");
  const [cadenceFilter, setCadenceFilter] = useState<string>("All");
  const [filingTypeFilter, setFilingTypeFilter] = useState<string>("All");
  const [dueMonthFilter, setDueMonthFilter] = useState<string>("All");
  const [assignedFilter, setAssignedFilter] = useState<string>("All");
  const [kpiFilter, setKpiFilter] = useState<WorklistKpi>("all");

  // ── Comment panel state ──
  const [activeCommentClientId, setActiveCommentClientId] = useState<string | null>(null);
  const [activeCommentMonth, setActiveCommentMonth] = useState<number>(-1);
  const [activeStxItemId, setActiveStxItemId] = useState<string | null>(null);
  const [activeRenewalItemId, setActiveRenewalItemId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");
  const [commentCategory, setCommentCategory] = useState<CommentCategory>("Other");
  const [commentRefreshKey, setCommentRefreshKey] = useState(0);
  const [commentPanelPos, setCommentPanelPos] = useState<{ top: number; left: number } | null>(null);

  // ── Close comment panel on outside click ──
  useEffect(() => {
    if (activeCommentMonth === -1) return;
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest(".comment-panel-wl") && !target.closest(".cdot")) {
        setActiveCommentClientId(null);
        setActiveCommentMonth(-1);
        setActiveStxItemId(null);
        setActiveRenewalItemId(null);
        setCommentPanelPos(null);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [activeCommentMonth]);

  // ── Cadence filter options (dynamic per module) ──
  const cadenceOptions = useMemo(() => {
    if (variant === "payroll") {
      return ["Weekly", "Bi-Weekly A", "Bi-Weekly B", "Semi-Monthly", "Monthly"];
    }
    if (serviceKey === "financials" || serviceKey === "sales_tax") {
      return ["Monthly", "Quarterly", "Annual"];
    }
    if (variant === "t9") {
      return ["Yearly"];
    }
    return [];
  }, [serviceKey, variant]);

  // ── Filing type + due month filters (Tax Returns) ──
  const filingTypeOptions = useMemo(() => variant === "tax_returns" ? [
    "All", "C Corp.", "S Corp.", "Partnership", "SMLLC", "Personal", "Trust", "Non Profit", "Retirem Plan"
  ] : [], [variant]);

  const dueMonthOptions = useMemo(() => variant === "tax_returns" ? [
    "All", ...MONTHS_SHORT
  ] : [], [variant]);

  // ── Assigned-to filter options (service-level + line items only) ──
  const assignedOptions = useMemo(
    () => ["All", ...collectAssignmentOptions(serviceClients, serviceKey)],
    [serviceClients, serviceKey],
  );
  // ── Stage dropdown picker ──
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{
    top: number;
    left: number;
    placement: "below" | "above";
  } | null>(null);
  const dropdownAnchorRef = useRef<DOMRect | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click / scroll / resize so it never floats off the active cell
  useEffect(() => {
    if (!activeDropdown) return;
    const close = (e?: Event) => {
      if (e && dropdownRef.current && e.target instanceof Node && dropdownRef.current.contains(e.target)) {
        return;
      }
      setActiveDropdown(null);
      setDropdownPos(null);
      dropdownAnchorRef.current = null;
    };
    const onPointerDown = (e: MouseEvent) => close(e);
    const onScroll = () => close();
    const onResize = () => close();
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [activeDropdown]);

  // ── Filter clients by search + cadence ──
  const baseFilteredClients = useMemo(
    () => {
      let list = serviceClients;
      if (search) {
        const q = search.toLowerCase();
        list = list.filter((c) => {
          if (c.name.toLowerCase().includes(q)) return true;
          // For sales tax & state renewal, also search within line item names
          if (serviceKey === "sales_tax") {
            // Check pre-expanded data first (from stx/page.tsx)
            const stxName = (c._stxName || "").toLowerCase();
            if (stxName && stxName.includes(q)) return true;
            if (c._stxItem?.serviceName && c._stxItem.serviceName.toLowerCase().includes(q)) return true;
            if (c._mergedLineItems?.some((item: any) => {
              const n = (item.serviceName || "").toLowerCase();
              return n && n.includes(q);
            })) return true;
            // Fallback: check service line items
            const svc = c.services?.find((s: any) => s.key === "sales_tax");
            const items = svc?.salesTaxLineItems || [];
            return items.some((item: any) =>
              (item.serviceName || "").toLowerCase().includes(q)
            );
          }
          // State renewal: search within renewal item names
          if ((serviceKey === "renditions" || serviceKey === "annual_reports") && showRenewalColumns) {
            const rnName = (c._renewalName || "").toLowerCase();
            if (rnName && rnName.includes(q)) return true;
            if (c._renewalItem?.state && c._renewalItem.state.toLowerCase().includes(q)) return true;
          }
          return false;
        });
      }
      if (cadenceFilter !== "All") {
        if (variant === "payroll") {
          list = list.filter((c) => {
            const svc = c.services?.find((s: any) => s.key === "payroll");
            const cadence = normalizePayrollCadence(svc?.frequency);
            return cadence === cadenceFilter;
          });
        } else {
          // financials, sales_tax — filter by frequency directly
          list = list.filter((c) => {
            const svc = c.services?.find((s: any) => s.key === serviceKey);
            const raw = (svc?.frequency || "").trim().toLowerCase();
            const filter = cadenceFilter.trim().toLowerCase();
            // Normalize yearly/annual → same bucket
            return raw === filter
              || (raw === "yearly" && filter === "annual")
              || (raw === "annual" && filter === "yearly")
              || (raw === "annually" && filter === "annual");
          });
        }
      }
      // Tax Returns: filing type filter
      if (filingTypeFilter !== "All" && variant === "tax_returns") {
        list = list.filter((c) => {
          const svc = c.services?.find((s: any) => s.key === "tax_returns");
          return (svc?.filingType || "") === filingTypeFilter;
        });
      }
      // Tax Returns: due month filter
      if (dueMonthFilter !== "All" && variant === "tax_returns") {
        const monthNum = String(MONTHS_SHORT.indexOf(dueMonthFilter) + 1);
        list = list.filter((c) => {
          const svc = c.services?.find((s: any) => s.key === "tax_returns");
          return String(svc?.filingMonth || "") === monthNum;
        });
      }
      // Assigned-to filter (works across all worklist tabs)
      if (assignedFilter !== "All") {
        list = list.filter((c) => matchesAssignmentFilter(c, serviceKey, assignedFilter));
      }
      return list;
    },
    [serviceClients, search, cadenceFilter, variant, serviceKey, filingTypeFilter, dueMonthFilter, assignedFilter],
  );

  // Short name from "Last, First" format → "First"
  const toShortName = (name: string) => {
    if (!name.includes(",")) return name;
    return name.split(",")[1].trim();
  };

  // ── Comment helpers ──
  const getAuthorName = (): string => {
    if (typeof document !== "undefined") {
      const m = document.cookie.match(/(?:^|;\s*)tap_demo_email=([^;]*)/);
      if (m?.[1]) return decodeURIComponent(m[1]);
    }
    return "You";
  };

  const addComment = useCallback(async (clientId: string, monthIdx: number, text: string, stxItemId?: string, renewalItemId?: string, category: CommentCategory = "Other") => {
    if (!text.trim()) return;
    // Handle composite IDs from STX page (clientId::csId::serviceName)
    const origId = clientId.includes("::") ? clientId.split("::")[0] : clientId;
    const cl = clients.find((c: any) => c.id === clientId)
      || clients.find((c: any) => (c._originalClientId || c.id) === origId);
    if (!cl) { console.warn("addComment: client not found for", origId); return; }
    const svc = cl.services.find((s: any) => s.key === serviceKey);
    if (!svc?.csId) { console.warn("addComment: no csId on service", serviceKey, "for client", cl.name); return; }

    const newComment: any = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      month: monthIdx,
      text: text.trim(),
      category: normalizeCommentCategory(category),
      author: getAuthorName(),
      createdAt: new Date().toISOString(),
    };
    // ── STX per-line-item: store comment on the specific line item ──
    if (stxItemId && svc.salesTaxLineItems) {
      const items = svc.salesTaxLineItems.map((it: any) =>
        it.id === stxItemId ? { ...it, comments: [...(it.comments || []), newComment] } : it
      );
      svc.salesTaxLineItems = items;
      try {
        const res = await fetch("/api/clients", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csId: svc.csId, salesTaxLineItems: items }),
        });
        if (res.ok) {
          setCommentText("");
          setCommentRefreshKey(k => k + 1);
          onDataChange?.();
        }
      } catch (e) { console.error("Failed to add STX item comment:", e); }
      return;
    }

    // ── State renewal item: store comment on the renewal item ──
    if (renewalItemId && svc.stateRenewalItems) {
      const items = [...(svc.stateRenewalItems || [])];
      const itemIdx = items.findIndex((item: any) => item.id === renewalItemId);
      if (itemIdx < 0) { console.error("renewal item not found"); return; }
      items[itemIdx] = {
        ...items[itemIdx],
        comments: [...(items[itemIdx].comments || []), newComment],
      };
      svc.stateRenewalItems = items;
      try {
        const res = await fetch("/api/clients", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csId: svc.csId, stateRenewalItems: items }),
        });
        if (res.ok) {
          setCommentText("");
          setCommentRefreshKey(k => k + 1);
          onDataChange?.();
        }
      } catch (e) {
        console.error("Failed to add renewal item comment:", e);
      }
      return;
    }

    // ── Service-level comment (non-STX, non-renewal) ──
    const updatedComments = [...(svc.comments || []), newComment];
    svc.comments = updatedComments;
    try {
      const res = await fetch("/api/clients", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: origId,
          services: [{ csId: svc.csId, key: serviceKey, enabled: true, comments: updatedComments }],
        }),
      });
      if (res.ok) {
        setCommentText("");
        setCommentRefreshKey(k => k + 1);
      }
    } catch (e) {
      console.error("Failed to add comment:", e);
    }
  }, [clients, serviceKey]);

  const deleteComment = useCallback(async (clientId: string, monthIdx: number, commentId: string, stxItemId?: string, renewalItemId?: string) => {
    // Handle composite IDs from STX page (clientId::csId::serviceName)
    const origId = clientId.includes("::") ? clientId.split("::")[0] : clientId;
    const cl = clients.find((c: any) => c.id === clientId)
      || clients.find((c: any) => (c._originalClientId || c.id) === origId);
    if (!cl) { console.warn("deleteComment: client not found for", origId); return; }
    const svc = cl.services.find((s: any) => s.key === serviceKey);
    if (!svc?.csId) { console.warn("deleteComment: no csId on service", serviceKey); return; }

    // ── Sales tax line item: delete from line item comments ──
    if (stxItemId && svc.salesTaxLineItems) {
      const items = [...(svc.salesTaxLineItems || [])];
      const itemIdx = items.findIndex((item: any) => item.id === stxItemId);
      if (itemIdx < 0) return;
      items[itemIdx] = {
        ...items[itemIdx],
        comments: (items[itemIdx].comments || []).filter((c: any) => c.id !== commentId),
      };
      svc.salesTaxLineItems = items;
      try {
        const res = await fetch("/api/clients", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csId: svc.csId, salesTaxLineItems: items }),
        });
        if (res.ok) { setCommentRefreshKey(k => k + 1); onDataChange?.(); }
      } catch (e) { console.error("Failed to delete line item comment:", e); }
      return;
    }

    // ── State renewal item: delete from renewal item comments ──
    if (renewalItemId && svc.stateRenewalItems) {
      const items = [...(svc.stateRenewalItems || [])];
      const itemIdx = items.findIndex((item: any) => item.id === renewalItemId);
      if (itemIdx < 0) return;
      items[itemIdx] = {
        ...items[itemIdx],
        comments: (items[itemIdx].comments || []).filter((c: any) => c.id !== commentId),
      };
      svc.stateRenewalItems = items;
      try {
        const res = await fetch("/api/clients", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csId: svc.csId, stateRenewalItems: items }),
        });
        if (res.ok) { setCommentRefreshKey(k => k + 1); onDataChange?.(); }
      } catch (e) { console.error("Failed to delete renewal item comment:", e); }
      return;
    }

    // ── Service-level comment ──
    const updatedComments = (svc.comments || []).filter((c: any) => c.id !== commentId);
    svc.comments = updatedComments;
    try {
      const res = await fetch("/api/clients", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: origId,
          services: [{ csId: svc.csId, key: serviceKey, enabled: true, comments: updatedComments }],
        }),
      });
      if (res.ok) {
        setCommentRefreshKey(k => k + 1);
      }
    } catch (e) {
      console.error("Failed to delete comment:", e);
    }
  }, [clients, serviceKey]);

  // ── Staff list for dropdowns — only active members, full names, no duplicates ──
  const [staffList, setStaffList] = useState<string[]>([]);
  useEffect(() => {
    fetch("/api/profile-directory")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          const names = data
            .filter((p: any) => p.status === "Active")
            .map((p: any) => (p.name || "").trim())
            .filter(Boolean);
          setStaffList([...new Set(names)]);
        }
      })
      .catch(() => {});
  }, []);

  // ── Initialize worklist state from client data ──
  const [worklistState, setWorklistState] = useState<
    Record<string, WorklistStage[]>
  >(() => buildWorklistState(clients, serviceKey));

  // Re-sync when clients or service key changes (edits flow through updateServiceMonth)
  useEffect(() => {
    setWorklistState(buildWorklistState(clients, serviceKey));
  }, [clients, serviceKey]);

  // ── Resolve active dropdown cell info for portal ──
  const activeDropdownInfo = useMemo(() => {
    if (!activeDropdown) return null;
    const [clientId, monthIdxStr] = activeDropdown.split("|");
    const monthIdx = parseInt(monthIdxStr, 10);
    const client = serviceClients.find((c) => c.id === clientId);
    if (!client) return null;
    const key = `${clientId}:${serviceKey}`;
    const stages = worklistState[key];
    const stage = stages?.[monthIdx] ?? "";
    return { client, monthIdx, stage };
  }, [activeDropdown, serviceClients, serviceKey, worklistState]);

  // ── Payroll count state (number of runs completed per month) ──
  const [prCounts, setPrCounts] = useState<Record<string, number[]>>(() => {
    const map: Record<string, number[]> = {};
    for (const client of clients) {
      const svc = client.services.find((s: any) => s.key === "payroll");
      if (!svc?.enabled) continue;
      const key = `${client.id}:payroll`;
      if (svc.periodCounts && Array.isArray(svc.periodCounts)) {
        map[key] = [...svc.periodCounts];
      } else {
        map[key] = Array(12).fill(0);
      }
    }
    return map;
  });

  // Re-sync prCounts when clients change (only add new clients, never remove)
  useEffect(() => {
    setPrCounts((prev) => {
      const next: Record<string, number[]> = { ...prev };
      for (const client of clients) {
        const svc = client.services.find((s: any) => s.key === "payroll");
        if (!svc?.enabled) continue;
        const key = `${client.id}:payroll`;
        if (!next[key]) {
          if (svc.periodCounts && Array.isArray(svc.periodCounts)) {
            next[key] = [...svc.periodCounts];
          } else {
            next[key] = Array(12).fill(0);
          }
        }
      }
      return next;
    });
  }, [clients]);

  // Load payroll counts from period_counts API on mount (batch, year-specific refresh)
  useEffect(() => {
    if (variant !== "payroll" || serviceClients.length === 0) return;
    const yearStr = String(year);
    fetch(`/api/period-counts?year=${yearStr}`)
      .then((res) => res.json())
      .then((data) => {
        if (!data.counts || !Array.isArray(data.counts)) return;
        const countsByCsId: Record<string, number[]> = {};
        for (const c of data.counts) {
          const periodNum = typeof c.period === "number" ? c.period : parseInt(c.period);
          if (!periodNum) continue;
          const monthIdx = (periodNum % 100) - 1;
          if (monthIdx < 0 || monthIdx >= 12) continue;
          if (!countsByCsId[c.client_service_id]) countsByCsId[c.client_service_id] = Array(12).fill(0);
          countsByCsId[c.client_service_id][monthIdx] = Math.max(0, c.processed || 0);
        }
        setPrCounts((prev) => {
          const next = { ...prev };
          for (const client of serviceClients) {
            const svc = client.services?.find((s: any) => s.key === "payroll");
            if (!svc?.csId) continue;
            const key = `${client.id}:payroll`;
            if (countsByCsId[svc.csId]) next[key] = countsByCsId[svc.csId];
          }
          return next;
        });
      })
      .catch(() => {});
  }, [variant, serviceClients, year]);

  // Load t9 counts from period_counts API on mount (batch, year-specific refresh)
  useEffect(() => {
    if (variant !== "t9" || serviceClients.length === 0) return;
    const yearStr = String(year);
    fetch(`/api/period-counts?year=${yearStr}`)
      .then((res) => res.json())
      .then((data) => {
        if (!data.counts || !Array.isArray(data.counts)) return;
        const countsByCsId: Record<string, number[]> = {};
        for (const c of data.counts) {
          const periodNum = typeof c.period === "number" ? c.period : parseInt(c.period);
          if (!periodNum) continue;
          const monthIdx = (periodNum % 100) - 1;
          if (monthIdx < 0 || monthIdx >= 12) continue;
          if (!countsByCsId[c.client_service_id]) countsByCsId[c.client_service_id] = Array(12).fill(0);
          countsByCsId[c.client_service_id][monthIdx] = Math.max(0, c.processed || 0);
        }
        setT9Counts((prev) => {
          const next = { ...prev };
          for (const client of serviceClients) {
            const svc = client.services?.find((s: any) => s.key === "1099s");
            if (!svc?.csId) continue;
            const key = `${client.id}:1099s`;
            if (countsByCsId[svc.csId]) next[key] = countsByCsId[svc.csId];
          }
          return next;
        });
      })
      .catch(() => {});
  }, [variant, serviceClients, year]);

  // ── Payroll: get real cadence from client service ──
  function getClientPayrollCadence(client: any): PayrollCadence {
    const svc = client.services?.find((s: any) => s.key === "payroll");
    const freq = svc?.frequency || "Monthly";
    if (freq === "Weekly") return "Weekly";
    if (freq === "Bi-Weekly" || freq === "Bi-Weekly A") return "Bi-Weekly A";
    if (freq === "Bi-Weekly B") return "Bi-Weekly B";
    if (freq === "Semi-Monthly") return "Semi-Monthly";
    return "Monthly";
  }

  // ── Payroll bump handler ──
  const prBump = useCallback((clientId: string, monthIdx: number, ev: React.MouseEvent) => {
    if (isHistorical) return;
    const client = serviceClients.find((c: any) => c.id === clientId);
    if (!client) return;
    const svc = client.services?.find((s: any) => s.key === "payroll");
    const maxRuns = getMaxRunsPerMonth(getClientPayrollCadence(client));
    const key = `${clientId}:payroll`;
    setPrCounts((prev) => {
      const counts = [...(prev[key] ?? Array(12).fill(0))];
      const current = counts[monthIdx] || 0;
      // Regular click: if count > 0, decrement; if 0, increment (toggle)
      // Shift-click: always decrement (same behavior for non-zero cells)
      const next = ev.shiftKey
        ? Math.max(0, current - 1)
        : current > 0
          ? Math.max(0, current - 1)
          : Math.min(maxRuns, current + 1);
      counts[monthIdx] = next;
      // Persist
      if (svc?.csId) {
        const period = `${year}-${String(monthIdx + 1).padStart(2, "0")}`;
        fetch("/api/period-counts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_service_id: svc.csId, period, processed: next }),
        }).catch(() => {});
      }
      return { ...prev, [key]: counts };
    });
  }, [isHistorical, serviceClients, year]);

  // ── Payroll start edit ──
  const [editingPr, setEditingPr] = useState<string | null>(null);
  const [editPrValue, setEditPrValue] = useState("");

  const prStartEdit = useCallback((clientId: string, monthIdx: number, currentVal: number) => {
    if (isHistorical) return;
    setEditingPr(`${clientId}:${monthIdx}`);
    setEditPrValue(String(currentVal || 0));
  }, [isHistorical]);

  const prCommitEdit = useCallback((clientId: string, monthIdx: number) => {
    const client = serviceClients.find((c: any) => c.id === clientId);
    if (!client) return;
    const svc = client.services?.find((s: any) => s.key === "payroll");
    const maxRuns = getMaxRunsPerMonth(getClientPayrollCadence(client));
    let val = parseInt(editPrValue) || 0;
    val = Math.max(0, Math.min(maxRuns, val));
    const key = `${clientId}:payroll`;
    setPrCounts((prev) => {
      const counts = [...(prev[key] ?? Array(12).fill(0))];
      counts[monthIdx] = val;
      // Persist
      if (svc?.csId) {
        const period = `${year}-${String(monthIdx + 1).padStart(2, "0")}`;
        fetch("/api/period-counts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_service_id: svc.csId, period, processed: val }),
        }).catch(() => {});
      }
      return { ...prev, [key]: counts };
    });
    setEditingPr(null);
  }, [editPrValue, serviceClients, year]);

  // ── Cell click handler — opens stage picker dropdown ──
  const handleCellClick = useCallback(
    (clientId: string, monthIdx: number, e: React.MouseEvent) => {
      if (readOnly || isHistorical) return;
      const key = `${clientId}|${monthIdx}`;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setActiveDropdown((prev) => {
        if (prev === key) {
          setDropdownPos(null);
          dropdownAnchorRef.current = null;
          return null;
        }
        // Initial position: open below the cell, centered. Final clamp runs after mount.
        dropdownAnchorRef.current = rect;
        setDropdownPos({
          top: rect.bottom + 4,
          left: rect.left + rect.width / 2,
          placement: "below",
        });
        return key;
      });
    },
    [readOnly, isHistorical],
  );

  // ── Keep stage picker fully on-screen (flip above when needed, clamp edges) ──
  useEffect(() => {
    if (!dropdownPos || !dropdownRef.current || !dropdownAnchorRef.current) return;
    const el = dropdownRef.current;
    const menu = el.getBoundingClientRect();
    const anchor = dropdownAnchorRef.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 8;
    const gap = 4;

    let left = anchor.left + anchor.width / 2;
    // Horizontal clamp against actual menu width
    const half = menu.width / 2;
    if (left - half < pad) left = half + pad;
    if (left + half > vw - pad) left = vw - half - pad;

    // Prefer below; flip above when not enough room under the cell
    const spaceBelow = vh - anchor.bottom - pad;
    const spaceAbove = anchor.top - pad;
    let placement: "below" | "above" = "below";
    let top = anchor.bottom + gap;
    if (spaceBelow < menu.height && spaceAbove > spaceBelow) {
      placement = "above";
      top = anchor.top - gap - menu.height;
    }
    // Final vertical clamp so the whole menu stays in the viewport
    if (top < pad) top = pad;
    if (top + menu.height > vh - pad) top = Math.max(pad, vh - pad - menu.height);

    if (
      top !== dropdownPos.top ||
      left !== dropdownPos.left ||
      placement !== dropdownPos.placement
    ) {
      setDropdownPos({ top, left, placement });
    }
  }, [dropdownPos]);

  // ── Select a stage from dropdown ──
  const handleStageSelect = useCallback(
    (clientId: string, monthIdx: number, stage: WorklistStage, csId?: string) => {
      if (readOnly || isHistorical) return;
      const key = `${clientId}:${serviceKey}`;
      const stages = [...(worklistState[key] ?? [])];
      if (!stages.length) return;
      stages[monthIdx] = stage;
      setWorklistState((prev) => ({ ...prev, [key]: stages }));
      if (onStageChange) onStageChange(clientId, monthIdx, stage, csId);
      setActiveDropdown(null);
      setDropdownPos(null);
      dropdownAnchorRef.current = null;
    },
    [readOnly, isHistorical, serviceKey, worklistState, onStageChange],
  );


  // ── T9 counts local state ──
  const [t9Counts, setT9Counts] = useState<Record<string, number[]>>(() => {
    const map: Record<string, number[]> = {};
    for (const client of clients) {
      const svc = client.services.find((s: any) => s.key === "1099s");
      if (!svc?.enabled) continue;
      const key = `${client.id}:1099s`;
      if (svc.periodCounts && Array.isArray(svc.periodCounts)) {
        map[key] = [...svc.periodCounts];
      } else {
        map[key] = Array(12).fill(0);
      }
    }
    return map;
  });

  // Re-sync t9 counts when clients change
  useEffect(() => {
    setT9Counts((prev) => {
      const next: Record<string, number[]> = {};
      for (const client of clients) {
        const svc = client.services.find((s: any) => s.key === "1099s");
        if (!svc?.enabled) continue;
        const key = `${client.id}:1099s`;
        if (prev[key]) { next[key] = prev[key]; }
        else if (svc.periodCounts && Array.isArray(svc.periodCounts)) { next[key] = [...svc.periodCounts]; }
        else { next[key] = Array(12).fill(0); }
      }
      return next;
    });
  }, [clients]);

  // ── T9 count edit-in-place state ──
  const [editingT9, setEditingT9] = useState<string | null>(null);
  const [editT9Value, setEditT9Value] = useState("");

  const t9StartEdit = useCallback((clientId: string, monthIdx: number, currentVal: number) => {
    if (isHistorical) return;
    setEditingT9(`${clientId}:${monthIdx}`);
    setEditT9Value(String(currentVal || 0));
  }, [isHistorical]);

  const t9CommitEdit = useCallback((clientId: string, monthIdx: number, expectedVal?: number) => {
    const val = parseInt(editT9Value) || 0;
    const key = `${clientId}:1099s`;
    setT9Counts((prev) => {
      const counts = [...(prev[key] ?? Array(12).fill(0))];
      // Cap at expected — allow this cell up to (expected - sum of other months)
      const otherSum = counts.reduce((s, c, i) => s + (i === monthIdx ? 0 : c), 0);
      const maxAllowable = expectedVal ? Math.max(0, expectedVal - otherSum) : Infinity;
      counts[monthIdx] = Math.max(0, Math.min(val, maxAllowable));
      const svc = clients.find((c) => c.id === clientId)?.services.find((s: any) => s.key === "1099s");
      if (svc?.csId) {
        const period = `${year}-${String(monthIdx + 1).padStart(2, "0")}`;
        fetch("/api/period-counts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_service_id: svc.csId, period, processed: counts[monthIdx] }),
        }).catch(() => {});
      }
      return { ...prev, [key]: counts };
    });
    setEditingT9(null);
  }, [editT9Value, clients, year]);

  // ── Stats ──
  const stats = useMemo(() => {
    if (variant === "t9") {
      const isCur = !isHistorical;
      let expTot = 0, doneTot = 0;
      for (const client of serviceClients) {
        const svc = client.services.find((s) => s.key === serviceKey);
        if (!svc) continue;
        const exp = svc.expectedAnnual || 0;
        expTot += exp;
        const t9key = `${client.id}:1099s`;
        const counts = t9Counts[t9key] ?? Array(12).fill(0);
        const done = counts.reduce((s: number, n: number) => s + (n || 0), 0);
        doneTot += done;
      }
      const curMonthCount = isCur ? (() => {
        let c = 0;
        for (const client of serviceClients) {
          const t9key = `${client.id}:1099s`;
          const counts = t9Counts[t9key] ?? Array(12).fill(0);
          c += (counts[currentMonth] || 0);
        }
        return c;
      })() : 0;
      return { expTot, doneTot, rem: Math.max(0, expTot - doneTot), curMonthCount, currentMonthName: MONTHS_SHORT[currentMonth], isCur };
    }

    if (variant === "payroll") {
      const isCur = !isHistorical;
      let totalRuns = 0;
      let totalMax = 0;
      let monthRuns = 0;
      for (const client of serviceClients) {
        const cadence = getClientPayrollCadence(client);
        const maxRuns = getMaxRunsPerMonth(cadence);
        totalMax += maxRuns * 12;
        const key = `${client.id}:payroll`;
        const counts = prCounts[key] ?? Array(12).fill(0);
        for (let m = 0; m < 12; m++) {
          totalRuns += (counts[m] || 0);
        }
        if (isCur) {
          monthRuns += (counts[currentMonth] || 0);
        }
      }
      const pct = totalMax > 0 ? Math.round((totalRuns / totalMax) * 100) : 0;
      return {
        totalRuns, totalMax, pct,
        monthRuns, currentMonthName: MONTHS_SHORT[currentMonth], isCur,
      };
    }

    const currentMonthName = MONTHS_SHORT[currentMonth];
    let dueThisMonth = 0;
    let inProgress = 0;
    let waiting = 0;
    let prepared = 0;
    let done = 0;
    let behind = 0;
    let notStarted = 0;
    let yDue = 0, yDone = 0;

    for (const client of serviceClients) {
      const svc = client.services.find((s) => s.key === serviceKey);
      if (!svc) continue;
      const activeMonths = getActiveMonths(svc.frequency, svc.financialsMonth);

      const key = `${client.id}:${serviceKey}`;
      const stages = worklistState[key] ?? [];
      for (let m = 0; m < 12; m++) {
        if (!activeMonths.has(m)) continue;
        yDue++;
        if (stages[m] === "dn") yDone++;

        if (m === currentMonth && year === currentYear) {
          dueThisMonth++;
          if (!stages[m] || stages[m] === "") notStarted++;
        }
        switch (stages[m]) {
          case "ip": inProgress++; break;
          case "wc": waiting++; break;
          case "pp": prepared++; break;
          case "dl": behind++; break;
          case "dn": done++; break;
        }
      }
    }

    return { dueThisMonth, inProgress, waiting, prepared, done, behind, notStarted, currentMonthName, yDue, yDone };
  }, [serviceClients, serviceKey, currentMonth, year, currentYear, worklistState, isHistorical, prCounts, t9Counts]);

  const filteredClients = useMemo(() => filterWorklistKpi(baseFilteredClients, kpiFilter, {
    serviceKey,
    variant,
    currentMonth,
    stages: worklistState,
    periodCounts: variant === "payroll" ? prCounts : variant === "t9" ? t9Counts : {},
  }), [baseFilteredClients, kpiFilter, serviceKey, variant, currentMonth, worklistState, prCounts, t9Counts]);

  const exportCSV = useCallback(() => {
    exportClientCsv(filteredClients, {
      serviceKey,
      filenamePrefix: serviceLabel(serviceKey),
    });
  }, [filteredClients, serviceKey]);

  // ── Pipe payroll missing runs up to parent ──
  useEffect(() => {
    if (variant === "payroll" && onPayrollMissingRuns) {
      onPayrollMissingRuns(Math.max(0, stats.totalMax - stats.totalRuns));
    }
  }, [variant, onPayrollMissingRuns, stats.totalMax, stats.totalRuns]);

  // ── Stage legend ──
  const legendItems: { stage: WorklistStage; dot: string }[] = [
    { stage: "", dot: "·" },
    { stage: "ip", dot: "●" },
    { stage: "wc", dot: "●" },
    { stage: "pp", dot: "●" },
    { stage: "dn", dot: "●" },
    { stage: "na", dot: "●" },
  ];

  // ── Count of columns before month columns (for colspan) ──
  const baseCols = 2; // Client + Assigned
  const payrollCols = variant === "payroll" ? 2 : 0; // PayDay, QBO
  const taxReturnCols = variant === "tax_returns" ? 2 : 0; // Filing State, Filing Type
  const extraCols = serviceKey !== "renditions" && serviceKey !== "annual_reports" && serviceKey !== "tax_returns" && variant !== "t9" ? 1 : 0; // Cadence
  const t9PostCols = variant === "t9" ? 1 : 0; // Left
  const t9PreCols = variant === "t9" ? 1 : 0; // Expected
  const renewalCols = (serviceKey === "renditions" || serviceKey === "annual_reports") && showRenewalColumns ? 2 : 0; // State, Due
  const colCount = baseCols + renewalCols + payrollCols + taxReturnCols + extraCols + t9PreCols + 12 + t9PostCols;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="flex flex-col items-center gap-2">
          <div className="w-6 h-6 border-2 border-[var(--teal)] border-t-transparent rounded-full animate-spin"></div>
          <span className="text-xs text-[var(--muted)]">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ── Stats row (demo: stat cards) ── */}
      {variant === "t9" ? (
        <div className="stats" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
          <StatCard label="Expected (year)" value={stats.expTot} color="var(--ink)" active={kpiFilter === "all"} onClick={() => setKpiFilter("all")} />
          <StatCard label="Processed" value={stats.doneTot} color="var(--green)" active={kpiFilter === "processed"} onClick={() => setKpiFilter("processed")} />
          <StatCard label="Remaining" value={Math.max(0, stats.expTot - stats.doneTot)} color="var(--amber)" active={kpiFilter === "remaining"} onClick={() => setKpiFilter("remaining")} />
          <StatCard label={stats.isCur ? `In ${stats.currentMonthName}` : `Period total`} value={stats.isCur ? stats.curMonthCount : stats.doneTot} color="var(--blue)" active={kpiFilter === "current_month"} onClick={() => setKpiFilter("current_month")} />
        </div>
      ) : variant === "payroll" ? (
        <div className="stats" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
          <StatCard label="Total Clients" value={serviceClients.length} color="var(--ink)" active={kpiFilter === "all"} onClick={() => setKpiFilter("all")} />
          <StatCard label="Total Runs" value={stats.totalRuns ?? 0} color="var(--blue)" active={kpiFilter === "runs"} onClick={() => setKpiFilter("runs")} />
          <StatCard label="Max Runs" value={stats.totalMax ?? 0} color="var(--muted)" active={kpiFilter === "max_runs"} onClick={() => setKpiFilter("max_runs")} />
          <StatCard label="Completion" value={(stats.pct ?? 0) + "%"} color="var(--green)" active={kpiFilter === "incomplete"} onClick={() => setKpiFilter("incomplete")} />
          <StatCard label={stats.isCur ? `In ${stats.currentMonthName}` : `Month runs`} value={stats.monthRuns ?? 0} color="var(--amber)" active={kpiFilter === "month_runs"} onClick={() => setKpiFilter("month_runs")} />
        </div>
      ) : (
      <div className="stats" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
        {!isHistorical ? (
          <>
            <StatCard label="Total Clients" value={serviceClients.length} color="var(--ink)" active={kpiFilter === "all"} onClick={() => setKpiFilter("all")} />
            <StatCard label="In progress" value={stats.inProgress} color="var(--blue)" active={kpiFilter === "in_progress"} onClick={() => setKpiFilter("in_progress")} />
            <StatCard label="Waiting on client" value={stats.waiting} color="var(--amber)" active={kpiFilter === "waiting"} onClick={() => setKpiFilter("waiting")} />
            <StatCard label="Delayed" value={stats.behind ?? 0} color="var(--red)" active={kpiFilter === "delayed"} onClick={() => setKpiFilter("delayed")} />
            <StatCard label={variant === "tax_returns" ? "Filed" : "Done"} value={stats.done} color="var(--green)" active={kpiFilter === "done"} onClick={() => setKpiFilter("done")} />
            <StatCard label="Not started" value={stats.notStarted || 0} color="var(--red)" active={kpiFilter === "not_started"} onClick={() => setKpiFilter("not_started")} />
          </>
        ) : (
          <>
            <StatCard label="Total periods" value={stats.yDue} color="var(--ink)" active={kpiFilter === "all"} onClick={() => setKpiFilter("all")} />
            <StatCard label="Completed" value={stats.yDone} color="var(--green)" active={kpiFilter === "done"} onClick={() => setKpiFilter("done")} />
            <StatCard label="Not completed" value={Math.max(0, stats.yDue - stats.yDone)} color="var(--amber)" active={kpiFilter === "not_started"} onClick={() => setKpiFilter("not_started")} />
          </>
        )}
      </div>
      )}

      {/* ── Search + Cadence filter ── */}
      <div className="flex gap-2 items-center">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search clients..."
          className="flex-1 px-3 py-2 rounded-lg border border-[var(--line)] bg-[var(--card)] text-[13px] text-[var(--ink)] outline-none transition-colors focus:border-[var(--teal)] focus:ring-2 focus:ring-[var(--teal-soft)] placeholder:text-[var(--muted)]"
        />
        {cadenceOptions.length > 0 && (
          <select
            value={cadenceFilter}
            onChange={(e) => setCadenceFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-[var(--line)] bg-[var(--card)] text-[13px] text-[var(--ink)] outline-none transition-colors focus:border-[var(--teal)] focus:ring-2 focus:ring-[var(--teal-soft)] cursor-pointer"
          >
            <option value="All">All cadences</option>
            {cadenceOptions.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        )}
        {assignedOptions.length > 1 && (
          <select
            value={assignedFilter}
            onChange={(e) => setAssignedFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-[var(--line)] bg-[var(--card)] text-[13px] text-[var(--ink)] outline-none transition-colors focus:border-[var(--teal)] focus:ring-2 focus:ring-[var(--teal-soft)] cursor-pointer"
          >
            <option value="All">All staff</option>
            {assignedOptions.filter(opt => opt !== "All").map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        )}
        {variant === "tax_returns" && (
          <>
            <select
              value={filingTypeFilter}
              onChange={(e) => setFilingTypeFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border border-[var(--line)] bg-[var(--card)] text-[13px] text-[var(--ink)] outline-none transition-colors focus:border-[var(--teal)] focus:ring-2 focus:ring-[var(--teal-soft)] cursor-pointer"
            >
              <option value="All">All types</option>
              {filingTypeOptions.filter(opt => opt !== "All").map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
            <select
              value={dueMonthFilter}
              onChange={(e) => setDueMonthFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border border-[var(--line)] bg-[var(--card)] text-[13px] text-[var(--ink)] outline-none transition-colors focus:border-[var(--teal)] focus:ring-2 focus:ring-[var(--teal-soft)] cursor-pointer"
            >
              <option value="All">All months</option>
              {dueMonthOptions.filter(opt => opt !== "All").map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </>
        )}
        {search && filteredClients.length < serviceClients.length && (
          <span className="text-[11px] text-[var(--muted)] whitespace-nowrap">
            {filteredClients.length} of {serviceClients.length}
          </span>
        )}
      </div>


      {/* ── Info line + Legend row ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", margin: "6px 2px", gap: 8 }}>
        <div className="text-xs" style={{ color: "var(--muted)" }}>
          {serviceKey === "sales_tax"
            ? "Grouped by client — each registration tracked on its own row. Open one for its bank details and notes."
            : variant === "tax_returns"
            ? `${serviceClients.length} client${serviceClients.length !== 1 ? "s" : ""} · highlighted column = this month (${MONTHS_SHORT[currentMonth]}) · filing month shows visual highlight`
            : !isHistorical
            ? `${serviceClients.length} client${serviceClients.length !== 1 ? "s" : ""} · highlighted column = this month (${MONTHS_SHORT[currentMonth]})`
            : `${serviceClients.length} client${serviceClients.length !== 1 ? "s" : ""} · ${year} history`}
        </div>
        <button
          type="button"
          onClick={exportCSV}
          title={`Export ${filteredClients.length} filtered ${serviceLabel(serviceKey)} clients`}
          className="px-3 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-xs font-semibold text-[var(--ink)] hover:border-[var(--teal)]"
        >
          Export {filteredClients.length} filtered
        </button>
        {/* Legend — status color indicators (hidden for t9 only) */}
        {variant !== "t9" && (
        <div className="flex flex-wrap items-center gap-3.5 text-xs" style={{ zIndex: 5 }}>
          {STAGE_CYCLE.filter(s => s !== "" && s !== "na").map(s => (
            <span key={s} className="inline-flex items-center gap-1.5" style={{ color: "var(--muted)" }}>
              <i style={{ width: 11, height: 11, borderRadius: 3, display: "inline-block", background: STAGE_STYLES[s].fg }}></i>
              {getStageLabel(s, variant)}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5" style={{ color: "var(--muted)" }}><i style={{ width: 11, height: 11, borderRadius: 3, display: "inline-block", background: "repeating-linear-gradient(45deg, var(--red) 0px, var(--red) 2px, transparent 2px, transparent 4px)" }}></i>N/A</span>
          <span className="inline-flex items-center gap-1.5" style={{ color: "var(--muted)" }}><i style={{ width: 11, height: 11, borderRadius: 3, display: "inline-block", background: "#c2c8d4" }}></i>Not due</span>
          {variant === "tax_returns" && (
            <span className="inline-flex items-center gap-1.5" style={{ color: "var(--muted)" }}><i style={{ width: 6, height: 6, borderRadius: 1, display: "inline-block", background: "var(--teal)", boxShadow: "0 0 0 1.5px #fff" }}></i>Filing month</span>
          )}
          <span className="inline-flex items-center gap-1.5" style={{ color: "var(--muted)" }}><i style={{ width: 6, height: 6, borderRadius: "50%", display: "inline-block", background: "var(--blue)", boxShadow: "0 0 0 1.5px #fff" }}></i>Has comments</span>
        </div>
        )}
      </div>

      {/* ── Main table with scroll arrows ── */}
      <div style={{ position: "relative" }}>
        <button
          onClick={() => {
            const el = document.getElementById(`table-scroll-${serviceKey}`);
            if (el) el.scrollBy({ left: -200, behavior: "smooth" });
          }}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full flex items-center justify-center shadow-md border border-[var(--line)] cursor-pointer hover:scale-110 transition-transform"
          style={{ background: "var(--card)", color: "var(--ink)", fontSize: 14, lineHeight: 1 }}
          aria-label="Scroll left"
        >{'\u2039'}</button>
      <div id={`table-scroll-${serviceKey}`} style={{ overflowX: "auto", borderRadius: 14, border: "1px solid var(--line)", scrollBehavior: "smooth" }}>
      <table className="worklist-table" style={{ width: "max-content", minWidth: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "var(--card)", borderBottom: "2px solid var(--line)" }}>
             <th className="text-left text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider px-1.5 py-2" style={{ width: 160, minWidth: 120, maxWidth: 220 }}>Client / Line Item</th>
            {variant === "payroll" && (
            <>
              <th className="text-left text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider px-1 py-2" style={{ width: 80, maxWidth: 100 }}>Pay Day</th>
            </>
            )}
            {variant === "tax_returns" && (
            <>
              <th className="text-left text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider px-1 py-2" style={{ width: 70, maxWidth: 80 }}>Filing St</th>
              <th className="text-left text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider px-1 py-2" style={{ width: 80, maxWidth: 100 }}>Filing Type</th>
            </>
            )}
            {((serviceKey === "renditions" || serviceKey === "annual_reports")) && showRenewalColumns && (
            <>
              <th className="text-left text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider px-1 py-2" style={{ width: 50, maxWidth: 60 }}>State</th>
              <th className="text-left text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider px-1 py-2" style={{ width: 70, maxWidth: 80 }}>Due</th>
            </>
            )}
            <th className="text-left text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider px-1 py-2" style={{ width: 120, maxWidth: 150 }}>Assigned</th>
            {serviceKey !== "renditions" && serviceKey !== "annual_reports" && serviceKey !== "tax_returns" && variant !== "t9" && (
            <th className="text-left text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider px-1 py-2" style={{ width: 90, maxWidth: 100 }}>Cadence</th>
            )}
            {variant === "t9" && (
            <th className="text-center text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider px-1 py-2" style={{ width: 60, minWidth: 60 }}>Expected</th>
            )}
            {MONTHS_SHORT.map((m, mi) => {
              return (
                <th key={m}
                  className="text-center text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider px-0.5 py-2"
                  style={{
                    width: variant === "t9" ? 44 : 30,
                  }}
                >{m}</th>
              );
            })}
            {variant === "t9" && (
            <>
              <th className="text-center text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider px-0.5 py-2" style={{ width: 60, minWidth: 60 }}>Left</th>
            </>
            )}
          </tr>
        </thead>
        <tbody key={filteredClients.length}>
          {filteredClients.length === 0 && (
            <tr>
              <td colSpan={colCount} className="text-center py-8 text-sm text-[var(--muted)]">
                No clients found.
              </td>
            </tr>
          )}
          {filteredClients.length > 0 && (
            ((serviceKey === "sales_tax" || ((serviceKey === "renditions" || serviceKey === "annual_reports") && showRenewalColumns))
              ? // ── Sales Tax / Annual Reports: group by client, add group header rows ──
                // Flat clients may already be pre-expanded with _stxItem / _stxName from stx/page.tsx
                (() => {
                  let expanded: any[] = [];
                  const hasPreExpanded = filteredClients.some((c: any) => c._stxItem !== undefined || c._stxName !== undefined || c._renewalItem !== undefined);
                  if (hasPreExpanded) {
                    // Preserve ALL rows — pre-expanded keep their _stxItem, others get fallback
                    expanded = filteredClients.map((c: any) => {
                      if (c._stxItem != null || c._stxName) return c;
                      if (c._renewalItem != null) return c;
                      return { ...c, _stxItem: null, _stxIdx: -1, _stxName: c.name };
                    });
                  } else {
                    // Legacy: expand line items from service
                    for (const client of filteredClients) {
                      const svc = client.services?.find((s: any) => s.key === "sales_tax");
                      const items = svc?.salesTaxLineItems;
                      if (items?.length > 0) {
                        items.forEach((item: any, idx: number) => {
                          expanded.push({
                            ...client,
                            _stxItem: item,
                            _stxIdx: idx,
                            _stxName: svc?.serviceName || item.serviceName,
                          });
                        });
                      } else {
                        expanded.push({ ...client, _stxItem: null, _stxIdx: -1, _stxName: client.name });
                      }
                    }
                  }
                  // If searching, further filter by line item name
                  let filteredExpanded = expanded;
                  if (search) {
                    const q = search.toLowerCase();
                    filteredExpanded = expanded.filter((row) => {
                      if (row._renewalItem != null) {
                        const rn = (row._renewalName || "").toLowerCase();
                        const cn = (row.name || "").toLowerCase();
                        return rn.includes(q) || cn.includes(q) || (row._renewalItem?.state || "").toLowerCase().includes(q);
                      }
                      if (row._stxItem == null) {
                        return row.name.toLowerCase().includes(q);
                      }
                      const itemName = (row._stxName || "").toLowerCase();
                      const clientName = (row.name || "").toLowerCase();
                      // Both must be checked — if neither contains the search term, exclude
                      if (!itemName && !clientName) return false;
                      return itemName.includes(q) || clientName.includes(q);
                    });
                  }
                  const regCounts = new Map<string, number>();
                  for (const row of filteredExpanded) {
                    const origId = row._originalClientId || row.id.split("::")[0] || row.id;
                    regCounts.set(origId, (regCounts.get(origId) || 0) + 1);
                  }
                  // Build final array with group headers inserted
                  const rows: any[] = [];
                  let prevOrigId: string | null = null;
                  for (const row of filteredExpanded) {
                    const origId = row._originalClientId || row.id.split("::")[0] || row.id;
                    if (origId !== prevOrigId) {
                      const count = regCounts.get(origId) || 0;
                      rows.push({ _isGroupHeader: true, _groupOrigId: origId, _groupCount: count });
                      prevOrigId = origId;
                    }
                    rows.push(row);
                  }
                  // If final rows are empty, let the parent empty-state handle it
                return rows;
                })()
              : filteredClients
            ).map((client: any, _mapIdx: number) => {
              // ── Group header row ──
              if (client._isGroupHeader) {
                const svcLabel = serviceKey === "sales_tax" ? "registration" : (serviceKey === "renditions" || serviceKey === "annual_reports") ? "state renewal" : "item";
                return (
                  <tr className="stxband">
                    <td colSpan={colCount}>
                      <b>{client._groupOrigId ? (() => {
                        const found = serviceClients.find((c: any) => (c._originalClientId || c.id) === client._groupOrigId);
                        return found ? <>{found.name}{found.active === false && <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 700, color: "#c62828", background: "rgba(255,255,255,.85)", padding: "1px 6px", borderRadius: 3 }}>INACTIVE</span>}</> : '';
                      })() : ''}</b> <span style={{ color: "rgba(255,255,255,.7)" }}>· {client._groupCount} {svcLabel}{client._groupCount !== 1 ? "s" : ""}</span>
                    </td>
                  </tr>
                );
              }
              const svc = client.services.find((s: any) => s.key === serviceKey)!;
              const isStxItem = serviceKey === "sales_tax" && client._stxItem;
              const stxItem = client._stxItem;
              const stxIdx = client._stxIdx;
              const displayName = isStxItem ? (client._stxName || "—") : client.name;

              // State renewal line items (Annual Reports tab)
              const isRenewalItem = (serviceKey === "renditions" || serviceKey === "annual_reports") && client._renewalItem;
              const renewalItem = client._renewalItem;
              const renewalIdx = client._renewalIdx;
              const renewalDisplayName = isRenewalItem ? (client._renewalName || `—`) : client.name;
              const groupName = isRenewalItem ? client.name : null; // for group header lookups
              const activeMonths = getActiveMonths(svc.frequency, svc.financialsMonth);
              const key = `${client.id}:${serviceKey}`;
              const stages = worklistState[key] ?? Array(12).fill("");

              const payrollSvc = client.services.find((s: any) => s.key === "payroll");
              const processor = payrollSvc?.processor || "-";

              // ── T9 variant: count-based table ──
              if (variant === "t9") {
                const exp = svc.expectedAnnual || 0;
                const t9key = `${client.id}:1099s`;
                const counts = t9Counts[t9key] ?? Array(12).fill(0);
                const done = counts.reduce((a: number, b: number) => a + (b || 0), 0);
                const left = Math.max(0, exp - done);
                return (
                  <tr key={client.id} className="transition-colors" style={{ borderBottom: "1px solid var(--line)" }}>
                    <td className="px-1.5 py-1" style={{ width: 160, minWidth: 120, maxWidth: 220 }}>
                      <button onClick={() => onClientClick?.(client.id)}
                        className="text-xs font-medium text-[var(--ink)] truncate text-left w-full bg-transparent border-none cursor-pointer hover:text-[var(--teal)] transition-colors p-0">{client.name}</button>
                    </td>
                    <td className="px-1 py-1 text-[11px] text-[var(--muted)] whitespace-nowrap truncate" style={{ width: 120, maxWidth: 150 }}>
                      <span className="text-[var(--ink)]">{toShortName(svc.assignedTo || svc.processor || "—")}</span>
                    </td>
                    {serviceKey !== "renditions" && serviceKey !== "annual_reports" && serviceKey !== "tax_returns" && variant !== "t9" && (
                    <td className="px-1.5 py-1 text-[11px] text-[var(--muted)] whitespace-nowrap truncate">{svc.frequency}</td>
                    )}
                    <td className="px-1.5 py-1 text-center text-[11px] font-semibold text-[var(--ink)] tabular-nums" style={{ width: 60, minWidth: 60 }}>{exp || "—"}</td>
                    {MONTHS_SHORT.map((mo, i) => {
                      const n = +counts[i] || 0;
                      const isCM = i === currentMonth && !isHistorical;
                      const cellEditKey = `${client.id}:${i}`;
                      const isEditing = editingT9 === cellEditKey;
                      const hasT9Cmt = (svc.comments || []).some((c: any) => c.month === i);
                      const t9MonthComments = (svc.comments || []).filter((c: any) => c.month === i);
                      return (
                        <td key={mo} className={`mtd${isCM ? " mtd-now" : ""}`} style={{ position: "relative", width: 44, minWidth: 44, maxWidth: 44 }}>
                          {isEditing ? (
                            <input
                              type="number"
                              min="0"
                              max={exp || undefined}
                              value={editT9Value}
                              onChange={(e) => setEditT9Value(e.target.value)}
                              onBlur={() => t9CommitEdit(client.id, i, exp)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") t9CommitEdit(client.id, i, exp);
                                if (e.key === "Escape") setEditingT9(null);
                              }}
                              autoFocus
                              className="inline-flex items-center justify-center w-full h-6 rounded text-[11px] font-semibold tabular-nums text-center"
                              style={{
                                backgroundColor: "#fff",
                                border: "2px solid var(--teal)",
                                color: "var(--ink)",
                                outline: "none",
                              }}
                            />
                          ) : (
                            <div
                              onClick={!isHistorical ? () => t9StartEdit(client.id, i, n) : undefined}
                              className={`inline-flex items-center justify-center w-full h-6 rounded text-[11px] font-semibold tabular-nums transition-colors ${!isHistorical ? "cursor-pointer" : "cursor-default"} hover:scale-110 hover:shadow-sm active:scale-95`}
                              style={{
                                backgroundColor: n > 0 ? "var(--green-soft)" : "transparent",
                                color: n > 0 ? "var(--green)" : "var(--muted)",
                              }}
                              title={`${mo}: ${n} processed — click to edit`}
                            >{n || "·"}</div>
                          )}
                          {hasT9Cmt && (
                          <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const rect = (e.target as HTMLElement).getBoundingClientRect();
                                setCommentPanelPos({ top: Math.max(Math.min(rect.top - 120, window.innerHeight - 280), 10), left: Math.min(rect.left + 14, window.innerWidth - 320) });
                                const isOpen = activeCommentClientId === client.id && activeCommentMonth === i;
                                setActiveCommentClientId(isOpen ? null : client.id);
                                setActiveCommentMonth(isOpen ? -1 : i);
                                setActiveStxItemId(null);
                                if (!isOpen) setCommentText("");
                              }}
                              className="cdot"
                              style={{ all: "unset", cursor: "pointer", position: "absolute", top: 1, right: 1, zIndex: 3, width: 6, height: 6, borderRadius: "50%", background: "var(--blue)", boxShadow: "0 0 0 1.5px #fff" }}
                              title={`Comments for ${mo}`}
                            />
                          )}
                          {activeCommentClientId === client.id && activeCommentMonth === i && commentPanelPos && (
                            <div
                              className="comment-panel-wl"
                              style={{
                                position: "fixed", top: commentPanelPos.top, left: commentPanelPos.left, zIndex: 99999,
                                background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10,
                                padding: "10px 12px", boxShadow: "0 4px 16px rgba(0,0,0,.08)",
                                fontSize: 12, width: 240,
                              }}
                              onClick={e => e.stopPropagation()}
                            >
                              <div style={{ fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginBottom: 8 }}>
                                Comments — {mo}
                              </div>
                              {t9MonthComments.length > 0 && (
                                <div style={{ marginBottom: 8, maxHeight: 120, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                                  {t9MonthComments.map((cm: any) => (
                                    <div key={cm.id} style={{ background: "var(--paper)", borderRadius: 7, padding: "6px 8px", position: "relative" }}>
                                      <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 3 }}>
                                        <b>{cm.author}</b> · {new Date(cm.createdAt).toLocaleString()}
                                      </div>
                                      <div style={{ fontSize: 12, color: "var(--ink)", lineHeight: 1.4 }}>{cm.text}</div>
                                      <button
                                        onClick={() => deleteComment(client.id, i, cm.id, activeStxItemId ?? undefined)}
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
                                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addComment(client.id, i, commentText, activeStxItemId ?? undefined); } }}
                                  placeholder="Add a comment…"
                                />
                                <button
                                  onClick={() => addComment(client.id, i, commentText, activeStxItemId ?? undefined)}
                                  style={{ all: "unset", cursor: "pointer", background: "var(--teal)", color: "#fff", padding: "5px 10px", borderRadius: 7, fontWeight: 600, fontSize: 12 }}
                                >Send</button>
                              </div>
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-1.5 py-1 text-center text-[11px] font-semibold tabular-nums" style={{ width: 60, minWidth: 60 }}>
                      <span className={left > 0 ? "text-[var(--amber)]" : "text-[var(--green)]"}>{done}/{exp}</span>
                    </td>
                  </tr>
                );
              }

              return (
                <tr
                  key={client.id}
                  className="transition-colors"
                  style={{ borderBottom: "1px solid var(--line)" }}
                >
                  {/* Client / Line Item name (clickable) */}
                  <td className="px-1.5 py-1" style={{ width: 160, minWidth: 120, maxWidth: 220 }}>
                      <button onClick={() => onClientClick?.(client.id)}
                        className="text-xs font-medium text-[var(--ink)] truncate text-left w-full bg-transparent border-none cursor-pointer hover:text-[var(--teal)] transition-colors p-0"
                        title={`Open ${isRenewalItem ? renewalDisplayName : displayName} details`}
                      >{isRenewalItem ? renewalDisplayName : displayName}
                      </button>
                    </td>

                  {/* Payroll-specific columns: Pay Day (read-only) */}
                  {variant === "payroll" && (
                  <>
                    {/* Pay Day */}
                    <td className="px-1 py-1 text-[11px] text-[var(--ink)] whitespace-nowrap truncate" style={{ width: 80, maxWidth: 100 }}>
                      {svc.paydate || "—"}
                    </td>
                  </>
                  )}

                  {/* Tax Return columns: Filing State, Filing Type (read-only) */}
                  {variant === "tax_returns" && (
                  <>
                    {/* Filing State */}
                    <td className="px-1 py-1 text-[11px] text-[var(--ink)] whitespace-nowrap truncate" style={{ width: 70, maxWidth: 80 }}>
                      {svc.filingState || "—"}
                    </td>
                    {/* Filing Type */}
                    <td className="px-1 py-1 text-[11px] text-[var(--ink)] whitespace-nowrap truncate" style={{ width: 80, maxWidth: 100 }}>
                      {svc.filingType || "—"}
                    </td>
                  </>
                  )}

                  {/* Renditions columns: State, Due (clickable to open details) */}
                  {((serviceKey === "renditions" || serviceKey === "annual_reports")) && showRenewalColumns && (
                  <>
                    <td className="px-1 py-1 text-[11px] text-[var(--ink)] whitespace-nowrap truncate cursor-pointer hover:text-[var(--teal)]" style={{ width: 50, maxWidth: 60 }}
                      onClick={() => onClientClick?.(client.id)}>
                      {isRenewalItem ? (renewalItem?.state || "—") : (svc.renewalState || "—")}
                    </td>
                    <td className="px-1 py-1 text-[11px] text-[var(--ink)] whitespace-nowrap truncate cursor-pointer hover:text-[var(--teal)]" style={{ width: 70, maxWidth: 80 }}
                      onClick={() => onClientClick?.(client.id)}>
                      {(() => {
                        const item = isRenewalItem ? renewalItem : null;
                        const dm = item?.dueMonth || svc.renewalDueMonth;
                        const dd = item?.dueDay || svc.renewalDueDay;
                        return dm
                          ? `${MONTHS_SHORT[Math.max(0, Math.min(11, parseInt(dm || "1") - 1))] || dm.substring(0,3)}${dd ? ` ${dd}` : ""}`
                          : "\u2014";
                      })()}
                    </td>
                  </>
                  )}

                  {/* Assigned — per-item for STX and renewals, service-level for others */}
                  <td className="px-1 py-1 text-[11px] text-[var(--muted)] whitespace-nowrap truncate" style={{ width: 120, maxWidth: 150 }}>
                    {isStxItem ? (
                      <button onClick={() => onClientClick?.(client.id)}
                        className="text-[11px] text-[var(--ink)] truncate text-left w-full bg-transparent border-none cursor-pointer hover:text-[var(--teal)] transition-colors p-0"
                        title={`Open ${displayName} details`}
                      >{toShortName(stxItem.assignedTo || svc.assignedTo || svc.processor || "—")}</button>
                    ) : isRenewalItem ? (
                      <button onClick={() => onClientClick?.(client.id)}
                        className="text-[11px] text-[var(--ink)] truncate text-left w-full bg-transparent border-none cursor-pointer hover:text-[var(--teal)] transition-colors p-0"
                        title={`Open ${renewalDisplayName} details`}
                      >{toShortName(renewalItem?.assignedTo || "Unassigned")}</button>
                    ) : (
                      <span className="text-[var(--ink)]">{toShortName(svc.assignedTo || svc.processor || "—")}</span>
                    )}
                  </td>

                  {/* Cadence — read-only text */}
                  {serviceKey !== "renditions" && serviceKey !== "annual_reports" && serviceKey !== "tax_returns" && (
                  <td className="px-1 py-1 text-[11px] text-[var(--ink)] whitespace-nowrap truncate" style={{ width: 90, maxWidth: 100 }}>
                    {(() => {
                      const raw = variant === "payroll"
                        ? (svc.frequency || "Monthly")
                        : isStxItem
                        ? (stxItem.frequency || svc.frequency || "Monthly")
                        : (svc.frequency || "Monthly");
                      // Normalize to display labels matching the slideover dropdowns
                      const norm = (raw || "").trim().toLowerCase();
                      let label = "Monthly";
                      if (norm === "yearly" || norm === "annual") label = "Annual";
                      else if (norm === "annually") label = "Annually";
                      else if (norm === "semi_monthly" || norm === "semi-monthly" || norm === "semimonthly") label = "Semi-Monthly";
                      else label = (raw || "").trim() || "Monthly";
                      return isStxItem ? (
                        <button onClick={() => onClientClick?.(client.id)}
                          className="text-[11px] text-[var(--ink)] truncate text-left w-full bg-transparent border-none cursor-pointer hover:text-[var(--teal)] transition-colors p-0"
                          title={`Open ${displayName} details`}
                        >{label}</button>
                      ) : label;
                    })()}
                  </td>
                  )}

                  {/* Month cells */}
                  {MONTHS_SHORT.map((_m, i) => {
                    const isActive = activeMonths.has(i);
                    const isCurrentMonth = i === currentMonth && !isHistorical;
                    // Lock future months from status changes (current + past months are editable)
                    const cellReadOnly = readOnly || isHistorical || i > currentMonth;

                    // ── Default variant: mcell squares (demo v7 style) ──
                    const stage = (stages[i] || "") as WorklistStage;
                    const style = STAGE_STYLES[stage];

                    // ── Tax returns: filingMonth highlight ──
                    const clientFilingMonth = (variant === "tax_returns") ? (svc.filingMonth || "") : "";
                    const filingMonthNum = clientFilingMonth ? parseInt(clientFilingMonth, 10) - 1 : -1;
                    const isFilingMonth = filingMonthNum === i;

                    const t = stage === "" ? "·"
                      : stage === "ip" ? "•"
                      : stage === "wc" ? "⏳"
                      : stage === "pp" ? "✓"
                      : stage === "dl" ? "!"
                      : stage === "dn" ? "✓"
                      : stage === "na" ? "–" : "";
                    const lockHist = isHistorical && isActive;
                    // ── Comment marker: per-line-item for STX & renewals, service-level otherwise ──
                    const commentSource = isStxItem && stxItem
                      ? (stxItem.comments || [])
                      : isRenewalItem
                      ? (renewalItem?.comments || [])
                      : (serviceKey === "sales_tax" || serviceKey === "renditions" || serviceKey === "annual_reports")
                      ? []
                      : (svc.comments || []);
                    const hasCmt = commentSource.some((c: any) => c.month === i);
                    const monthComments = commentSource.filter((c: any) => c.month === i);
                    return (
                      <td key={i} className={`mtd${isCurrentMonth ? " mtd-now" : ""}`} style={{ position: "relative" }}>
                        {/* ── Filing month corner indicator ── */}
                        {isFilingMonth && (
                          <div style={{
                            position: "absolute", top: 1, left: 1,
                            width: 6, height: 6,
                            background: "var(--teal)",
                            borderRadius: 1,
                            zIndex: 2,
                            boxShadow: "0 0 0 1.5px #fff",
                          }} />
                        )}
                        <div
                          onClick={cellReadOnly ? undefined : (e) => { e.stopPropagation(); handleCellClick(client.id, i, e); }}
                          className="mcell"
                          style={{
                            width: "100%", height: 24, borderRadius: 4,
                            border: `${(serviceKey === "renditions" || serviceKey === "annual_reports") && !isActive ? "1px solid transparent" : `1px solid ${!isActive ? "transparent" : style.border}`}`,
                            background: (serviceKey === "renditions" || serviceKey === "annual_reports")
                              ? (!isActive ? "var(--line)" : stage === "na" ? `repeating-linear-gradient(45deg, ${style.bg} 0px, ${style.bg} 3px, #c0c4cc40 3px, #c0c4cc40 5px)` : style.bg)
                              : (!isActive ? "transparent" : stage === "na" ? `repeating-linear-gradient(45deg, ${style.bg} 0px, ${style.bg} 3px, #c0c4cc40 3px, #c0c4cc40 5px)` : style.bg),
                            color: !isActive ? (lockHist ? "var(--muted)" : "transparent") : style.fg,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            margin: "0 auto",
                            fontWeight: 600, fontSize: 11, userSelect: "none",
                            cursor: (!isActive || cellReadOnly) ? "default" : "pointer",
                            boxShadow: "none",
                            opacity: (serviceKey === "renditions" || serviceKey === "annual_reports") ? 1 : (!isActive && !lockHist ? 0 : 1),
                          } as React.CSSProperties}
                          title={`${MONTHS_SHORT[i]} — ${getStageLabel(stage, variant)}${isHistorical ? ` (${year})` : ""}${isFilingMonth ? " · Filing month" : ""}`}
                        >{isActive || lockHist ? t : ""}</div>
                        {/* ── Payroll: next pay date MM/DD in current month cell ── */}
                        {variant === "payroll" && isCurrentMonth && (
                          <div style={{ fontSize: 10, textAlign: "center", marginTop: 2, lineHeight: 1, whiteSpace: "nowrap" }}>
                            <span style={{ color: "var(--ink)" }}>
                              {formatPayrollStartDate(getPayrollStartDate(
                                svc?.frequency || svc?.payPeriodFrequency || "",
                                svc?.paydate || "",
                                svc?.pay_start_date || svc?.payStartDate,
                              ))}
                            </span>
                          </div>
                        )}
                        {hasCmt && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const rect = (e.target as HTMLElement).getBoundingClientRect();
                            setCommentPanelPos({ top: Math.max(Math.min(rect.top - 120, window.innerHeight - 280), 10), left: Math.min(rect.left + 14, window.innerWidth - 320) });
                            const isOpen = activeCommentClientId === client.id && activeCommentMonth === i;
                            setActiveCommentClientId(isOpen ? null : client.id);
                            setActiveCommentMonth(isOpen ? -1 : i);
                            setActiveStxItemId(isOpen ? null : (isStxItem ? (stxItem?.id ?? null) : null));
                            setActiveRenewalItemId(isOpen ? null : (isRenewalItem ? (renewalItem?.id ?? null) : null));
                            if (!isOpen) setCommentText("");
                            }}
                            className="cdot"
                            style={{ all: "unset", cursor: "pointer", position: "absolute", top: 1, right: 1, zIndex: 3, width: 6, height: 6, borderRadius: "50%", background: "var(--blue)", boxShadow: "0 0 0 1.5px #fff" }}
                            title={`Comments for ${MONTHS_SHORT[i]}`}
                            />
                        )}
                        {activeCommentClientId === client.id && activeCommentMonth === i && commentPanelPos && (
                          <div
                            className="comment-panel-wl"
                            style={{
                              position: "fixed", top: commentPanelPos.top, left: commentPanelPos.left, zIndex: 99999,
                              background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10,
                              padding: "10px 12px", boxShadow: "0 4px 16px rgba(0,0,0,.08)",
                              fontSize: 12, width: 240,
                            }}
                            onClick={e => e.stopPropagation()}
                          >
                            <div style={{ fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginBottom: 8 }}>
                              Comments — {MONTHS_SHORT[i]}{isStxItem ? ` — ${displayName}` : isRenewalItem ? ` — ${renewalDisplayName}` : ""}
                            </div>
                            {monthComments.length > 0 && (
                              <div style={{ marginBottom: 8, maxHeight: 120, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                                {monthComments.map((cm: any) => (
                                  <div key={cm.id} style={{ background: "var(--paper)", borderRadius: 7, padding: "6px 8px", position: "relative" }}>
                                    <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 3 }}>
                                      <b>{cm.author}</b> · {new Date(cm.createdAt).toLocaleString()}
                                      {isStxItem && <span style={{ marginLeft: 5, padding: "1px 4px", borderRadius: 4, background: "#e8f0fe", color: "#1d4ed8", fontWeight: 700 }}>{normalizeCommentCategory(cm.category)}</span>}
                                    </div>
                                    <div style={{ fontSize: 12, color: "var(--ink)", lineHeight: 1.4 }}>{cm.text}</div>
                                    <button
                                      onClick={() => deleteComment(client.id, i, cm.id, activeStxItemId ?? undefined, activeRenewalItemId ?? undefined)}
                                      style={{ all: "unset", cursor: "pointer", position: "absolute", top: 4, right: 6, color: "var(--red)", fontSize: 11, lineHeight: 1 }}
                                      title="Delete comment"
                                    >×</button>
                                  </div>
                                ))}
                              </div>
                            )}
                            <div style={{ display: "flex", gap: 6, marginBottom: isStxItem ? 6 : 0 }}>
                              <input
                                style={{ flex: 1, padding: "5px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 12, background: "var(--paper)" }}
                                value={commentText}
                                onChange={e => setCommentText(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addComment(client.id, i, commentText, activeStxItemId ?? undefined, activeRenewalItemId ?? undefined, commentCategory); setCommentCategory("Other"); } }}
                                placeholder="Add a comment…"
                              />
                              <button
                                onClick={() => { addComment(client.id, i, commentText, activeStxItemId ?? undefined, activeRenewalItemId ?? undefined, commentCategory); setCommentCategory("Other"); }}
                                style={{ all: "unset", cursor: "pointer", background: "var(--teal)", color: "#fff", padding: "5px 10px", borderRadius: 7, fontWeight: 600, fontSize: 12 }}
                              >Send</button>
                            </div>
                            {isStxItem && (
                              <select
                                aria-label="Sales Tax comment category"
                                value={commentCategory}
                                onChange={e => setCommentCategory(normalizeCommentCategory(e.target.value))}
                                style={{ width: "100%", padding: "5px 8px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 12, background: "var(--paper)" }}
                              >
                                {COMMENT_CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}
                              </select>
                            )}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      </div>
        <button
          onClick={() => {
            const el = document.getElementById(`table-scroll-${serviceKey}`);
            if (el) el.scrollBy({ left: 200, behavior: "smooth" });
          }}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full flex items-center justify-center shadow-md border border-[var(--line)] cursor-pointer hover:scale-110 transition-transform"
          style={{ background: "var(--card)", color: "var(--ink)", fontSize: 14, lineHeight: 1 }}
          aria-label="Scroll right"
        >{'\u203A'}</button>
      </div>

      {/* ── Fine-print note ── */}
      {variant === "t9" ? (
        <p className="text-[11px] text-[var(--muted)] leading-relaxed" style={{ margin: "14px 2px 0", fontStyle: "italic" }}>
          Set each client&rsquo;s expected total on their card; log how many you
          process each month here. &ldquo;Left&rdquo; stays amber until the
          expected count is cleared. Click a month to add one, shift-click to
          subtract.
        </p>
      ) : variant === "tax_returns" ? (
        <p className="text-[11px] text-[var(--muted)] leading-relaxed" style={{ margin: "14px 2px 0", fontStyle: "italic" }}>
          Every service uses one workflow: In progress → Waiting on Client → Prepared → Filed.
          &ldquo;Waiting on client&rdquo; signals you&rsquo;re blocked; anything past due flags red
          automatically. Filing month is marked with a teal square in the top-left corner.
        </p>
      ) : (
      <p className="text-[11px] text-[var(--muted)] leading-relaxed" style={{ margin: "14px 2px 0", fontStyle: "italic" }}>
        {!isHistorical
          ? serviceKey === "financials"
            ? "Every service uses one workflow: In progress → Waiting on client → Prepared → Done. Anything past due flags red on its own. Fees and billing are owner-only and stay out of the team&rsquo;s view."
            : "Every service uses one workflow: In progress → Waiting on client → Prepared → Done. &ldquo;Waiting on client&rdquo; signals you&rsquo;re blocked; anything past due flags red automatically."
          : `Read-only history for ${year}. Switch the Year selector back to ${currentYear} to make changes.`}
      </p>
      )}
      {/* ── Portal stage picker dropdown (rendered at body level, never clipped) ── */}
      {activeDropdown && activeDropdownInfo && dropdownPos && createPortal(
        <div
          ref={dropdownRef}
          className="stage-picker"
          role="listbox"
          style={{
            position: "fixed",
            zIndex: 99999,
            top: dropdownPos.top,
            left: dropdownPos.left,
            transform: "translateX(-50%)",
            background: "#fff",
            border: "1px solid #d8d2c4",
            borderRadius: 10,
            boxShadow: "0 8px 28px rgba(15,23,42,.18)",
            padding: "4px 0",
            minWidth: 190,
            maxHeight: "min(320px, calc(100vh - 16px))",
            overflowY: "auto",
            overflowX: "visible",
          }}
        >
          {STAGE_CYCLE.map((s) => {
            const ss = STAGE_STYLES[s];
            const isCurrent = activeDropdownInfo.stage === s;
            return (
              <div
                key={s}
                role="option"
                aria-selected={isCurrent}
                onClick={(e) => { e.stopPropagation(); handleStageSelect(activeDropdownInfo.client.id, activeDropdownInfo.monthIdx, s); }}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "7px 14px", cursor: "pointer", fontSize: 13, whiteSpace: "nowrap",
                  fontWeight: isCurrent ? 700 : 400,
                  color: isCurrent ? "var(--ink)" : "var(--muted)",
                  background: isCurrent ? "#f0f4f8" : "transparent",
                  borderBottom: s !== "na" ? "1px solid #f0ede8" : "none",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#f5f7fa"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = isCurrent ? "#f0f4f8" : "transparent"; }}
              >
                <i style={{
                  width: 12, height: 12, borderRadius: 4,
                  display: "inline-block", flexShrink: 0,
                  background: s === "na" ? "repeating-linear-gradient(45deg, var(--red) 0px, var(--red) 2px, transparent 2px, transparent 4px)"
                    : s === "" ? "#c2c8d4" : ss.fg,
                }} />
                <span>{s === "" ? "Not Started" : getStageLabel(s, variant)}</span>
                {isCurrent && <span style={{ marginLeft: "auto", color: "var(--teal)", fontSize: 14 }}>✓</span>}
              </div>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}

// ══════════════════════════════════════════════
// ── Cell Wrapper (handles delayed ring, current month highlight) ──
// ══════════════════════════════════════════════
function CellWrapper({
  isCurrentMonth,
  isPastDue,
  readOnly,
  onClick,
  children,
}: {
  isCurrentMonth: boolean;
  isPastDue: boolean;
  readOnly: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={readOnly ? undefined : onClick}
      disabled={readOnly}
      className={`inline-flex items-center justify-center w-full h-8 rounded transition-[background-color,color] ${
        readOnly ? "" : "hover:scale-110 hover:shadow-sm active:scale-95"
      }`}
      style={{
        backgroundColor: isCurrentMonth ? "var(--teal-soft)" : "transparent",
        boxShadow: isPastDue
          ? "0 0 0 2px var(--red)"
          : isCurrentMonth
            ? "inset 0 0 0 1px var(--teal)"
            : "none",
        border: "none",
        outline: "none",
      }}
      title={isPastDue ? "Delayed — past due and not completed" : undefined}
    >
      {children}
    </button>
  );
}

// ══════════════════════════════════════════════
// ── Comment Month Markers ──
// ══════════════════════════════════════════════
// ══════════════════════════════════════════════
// ── Stat Card (demo v7 exact, shared) ──
// ══════════════════════════════════════════════
function StatCard({
  label,
  value,
  color,
  active = false,
  onClick,
}: {
  label: string;
  value: number | string;
  color?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="statcard"
      onClick={onClick}
      aria-pressed={active}
      style={{
        flex: 1, minWidth: 120,
        backgroundColor: "var(--card)",
        border: active ? `2px solid ${color || "var(--teal)"}` : "1px solid var(--line)",
        borderRadius: 13,
        padding: "13px 16px",
        boxShadow: "0 1px 2px rgba(33,31,26,0.04)",
      }}
    >
      <div style={{
        fontFamily: '"Fraunces",Georgia,serif',
        fontWeight: 600, fontSize: 26, lineHeight: 1,
        color: color || "var(--ink)",
      }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
        {label}
      </div>
    </button>
  );
}
