// PracticeOps app map: the launch-pad tiles, the Operations rail, and the
// page heads. Copy follows practiceops_1.html; routes and module gates are ours.
import type { IconName } from "./icons";

export type AppId = "ops" | "bill" | "coll" | "help";

export interface AppDef {
  id: AppId;
  name: string;
  icon: IconName;
  desc: string;
  core?: boolean;
  /** Where the app opens. */
  href: string;
  /** Modules that unlock the tile; any one is enough. Empty means everyone signed in. */
  modules: string[];
  /** Shown as a launch-pad tile. Help & Support is reached from the top bar instead. */
  tile: boolean;
}

export const OPS_MODULES = [
  "Clients", "Workload", "Timesheet", "Financials", "Payroll", "Sales Tax", "1099s",
  "Tax Returns", "Renditions", "Annual Reports", "Vault", "Users & Access",
];

export const APPS: AppDef[] = [
  { id: "ops", name: "Operations", icon: "grid", core: true, href: "", modules: OPS_MODULES, tile: true,
    desc: "Every client, every service, one owner — plus the worklists, timesheet and vault the team runs on." },
  { id: "bill", name: "Billing", icon: "receipt", href: "/billing", modules: ["Billing"], tile: true,
    desc: "Price each client once. Invoices assemble themselves, and a deposit closes them." },
  { id: "coll", name: "Collections", icon: "bolt", href: "/collections", modules: ["Collections"], tile: true,
    desc: "The receivables ladder: who owes what, which reminder is next, and what needs a person." },
  { id: "help", name: "Help & Support", icon: "life", href: "/support", modules: ["Support"], tile: false,
    desc: "Raise a ticket, track it, and search what's already been answered." },
];

export interface RailItem {
  label: string;
  href: string;
  icon: IconName;
  module: string;
  role?: "admin";
}

/** Operations rail, in the design's order. Contacts, Tax Returns and Annual Reports are ours. */
export const OPS_NAV: Array<RailItem | "sep"> = [
  { label: "Clients", href: "/clients", icon: "users", module: "Clients" },
  { label: "Contacts", href: "/contacts", icon: "badge", module: "Clients" },
  { label: "Team Workload", href: "/workload", icon: "chart", module: "Workload" },
  { label: "Timesheet", href: "/time", icon: "clock", module: "Timesheet" },
  "sep",
  { label: "Monthly Financials", href: "/fin", icon: "chart", module: "Financials" },
  { label: "Payroll", href: "/pr", icon: "cash", module: "Payroll" },
  { label: "Sales Tax", href: "/stx", icon: "receipt", module: "Sales Tax" },
  { label: "1099s", href: "/t9", icon: "doc", module: "1099s" },
  { label: "Tax Returns", href: "/tax", icon: "doc", module: "Tax Returns" },
  { label: "Renditions", href: "/rend", icon: "home", module: "Renditions" },
  { label: "Annual Reports", href: "/annual", icon: "doc", module: "Annual Reports" },
  "sep",
  { label: "Password Vault", href: "/vault", icon: "lock", module: "Vault" },
  { label: "Users & Access", href: "/users", icon: "badge", module: "Users & Access" },
];

export const OPS_PATHS = OPS_NAV.filter((item): item is RailItem => item !== "sep").map(item => item.href);

/** Page heads: [title, subtitle]. Operations copy is the design's, word for word. */
export const PAGE_HEADS: Record<string, [string, string]> = {
  "/clients": ["Clients", "One record per client. Switch a service on and they appear in that worklist immediately — nobody re-types a name."],
  "/contacts": ["Contacts", "A shared directory for every client contact — organized for quick lookup and follow-through."],
  "/workload": ["Team Workload", "Who is carrying what, by client count and by estimated effort. Spot the overload before it bites."],
  "/time": ["Timesheet", "Live time capture by person and client. Lean on purpose — your own entries stay yours to correct."],
  "/fin": ["Monthly Financials", "Every client with financials switched on, month by month."],
  "/pr": ["Payroll", "Runs counted per month — weekly 4–5, bi-weekly up to 2 — rolled up to a monthly status."],
  "/stx": ["Sales Tax", "Cadence-aware: monthly and quarterly filers on one grid."],
  "/t9": ["1099s", "Counted per month against an annual expected total — they never all arrive together."],
  "/tax": ["Tax Returns", "Annual returns — clients flagged for tax prep."],
  "/rend": ["Renditions", "Annual property-tax renditions for flagged clients."],
  "/annual": ["Annual Reports", "State renewals — clients flagged for annual filings."],
  "/vault": ["Password Vault", "Portal logins grouped by client. Bank logins are deliberately not stored here."],
  "/users": ["Users & Access", "Who can sign in, what they can open, and who they report to. Owner-controlled."],
  "/billing": ["Billing", "Invoices, payments and balances. Balances come from the server and refresh after every change."],
  "/collections": ["Collections", "The follow-up ladder that keeps the firm from falling behind on getting paid. Balances come from Billing and approved A/R reports; nothing is sent to clients yet."],
  "/support": ["Help & Support", "Raise a ticket from inside the system so it arrives with the context already attached — who you are, where you were, and what the system was doing."],
  "/support/inbox": ["Support Inbox", "Firm-wide support tickets, grouped by application."],
  "/settings": ["Settings", "Your account details, password, and security settings."],
};

export const YEAR_PATHS = ["/fin", "/pr", "/stx", "/t9", "/rend", "/tax"];

/** Which app a pathname belongs to, for the top-bar breadcrumb. */
export function appForPath(pathname: string): AppDef | null {
  if (OPS_PATHS.includes(pathname)) return APPS[0];
  return APPS.find(app => app.href && (pathname === app.href || pathname.startsWith(`${app.href}/`))) || null;
}

export function canOpenApp(app: AppDef, allowedModules: string[]) {
  return app.modules.length === 0 || app.modules.some(module => allowedModules.includes(module));
}

export const ROLE_LABELS: Record<string, [string, string]> = {
  owner: ["Owner / Partner", "Everything, including fees, margin and the vault."],
  admin: ["Admin", "Everything an owner sees, for running the firm day to day."],
  manager: ["Manager", "Full delivery view. No fees, no margin."],
  staff: ["Staff", "The worklists they own, plus their own time."],
  offshore: ["Offshore Team", "Assigned worklists only, through the secure web door."],
};

export const FIRM = { name: "TAP Associates, LLC", city: "Houston, TX" };
