// ── TAP Client Hub · TypeScript Types (Schema v2) ──

export type ClientType = "Business" | "Personal";
export type ServiceTracking = "stage" | "count";
export type WorkStage = "not_started" | "in_progress" | "waiting_client" | "prepared" | "done" | "na";
export type MonthStatus = "done" | "billed" | "paid" | "na" | "lock" | "in_progress" | "waiting" | "delayed";
export type ServiceCode = "FIN" | "PR" | "STX" | "T9" | "REND" | "TAX" | "RENEWAL";
export type ServiceKey = "financials" | "payroll" | "sales_tax" | "1099s" | "renditions" | "annual_reports" | "tax_returns";

export interface ServiceConfig {
  code: ServiceCode;
  name: string;
  key?: ServiceKey;
  label?: string;
  tracking: ServiceTracking;
  active: boolean;
  enabled?: boolean;
  frequency?: string;
  processor?: string;
  software?: string;
  expectedAnnual?: number;
  months?: any[];
  currentStage?: string;
}

export interface CommentEntry {
  id: string;
  month: number; // 0-11
  text: string;
  author: string;
  createdAt: string; // ISO timestamp
  category?: "Delayed" | "Waiting on client" | "Issues" | "Other";
}

export interface SalesTaxLineItem {
  serviceName: string;
  rt: string;
  taxId: string;
  bankName?: string;
  bankRouting?: string;
  bankAccount?: string;
  frequency?: string;
}

export interface ClientService {
  id: string;
  csId?: string;
  clientId: string;
  service: ServiceConfig;
  assignedTo?: string;
  active: boolean;
  enabled?: boolean;
  frequency?: string;
  key?: ServiceKey;
  label?: string;
  processor?: string;
  software?: string;
  expectedAnnual?: number;
  months?: any[];
  salesTaxNotes?: string;
  financialsMonth?: number;
  taxId?: string;
  bankName?: string;
  bankRouting?: string;
  bankAccount?: string;
  groupAssignedTo?: string;
  salesTaxRT?: string;
  salesTaxLineItems?: SalesTaxLineItem[];
  processorOther?: string;
  cdg?: string;
  eftps?: string;
  payrollPassword?: string;
  paydate?: string;
  periodCounts?: number[];
  currentStage?: string;
  // 7/2 redesign fields
  biweeklyCode?: string; // "1 - ODD" | "2 - EVEN" | group codes
  payStartDate?: string; // mm/dd
  payPeriodFrequency?: string; // Monthly | Semi-Monthly | Bi-Weekly | Quarterly
  reportingMethod?: string; // PR Reports only | Email Paystub to Client | Log into Client
  payrollCategory?: string; // Monthly | Salary | SAME | Right Network | Tushar
  qbLicense?: string; // QuickBooks license number
  reportingNotes?: string; // Extended notes about payroll filing/reporting
  filingState?: string;
  filingMonth?: string;
  filingType?: string; // "C Corp." | "S Corp." | "Partnership" | "SMLLC" | "Trust" | "Non Profit" | "Retirem Plan"
  // State renewal
  serviceName?: string;
  // Sales tax service name (from spreadsheet column E)
  stateRenewal?: boolean | null;
  renewalState?: string | null;
  renewalDueMonth?: string | null;
  renewalDueDay?: string | null;
  renewalIdentifiers?: string | null;
  stateRenewalItems?: any[];
  payEmails?: string[];
  comments?: CommentEntry[];
  svcNotes?: string;
}

export type PayrollSchedule = Pick<
  ClientService,
  "csId" | "key" | "frequency" | "payPeriodFrequency" | "paydate" | "payStartDate" | "periodCounts" | "financialsMonth"
> & { csId?: string | number };

export interface Client {
  id: string;
  cid: string;
  name: string;
  type: ClientType;
  entityType?: string;
  group?: string;
  groupName?: string;
  contact?: string;
  status: string;
  active?: boolean;
  activeUpdatedAt?: string | null;
  activeUpdatedBy?: string | null;
  city: string;
  state: string;
  zip?: string;
  address: string;
  emails: string[];
  phones: string[];
  services: ClientService[];
  /** Every payroll client-service row; clients may have multiple cadences. */
  payrollSchedules?: PayrollSchedule[];
  assignedStaff?: string;
  ein?: string;
  notes?: string;
}

export interface Profile {
  id: string;
  fullName: string;
  role: "admin" | "manager" | "staff" | "offshore";
  location?: string;
  reportingManager?: string;
  modules: string[];
  inviteStatus: "invited" | "active" | "disabled";
  active: boolean;
}

export interface WorkPeriod {
  id: string;
  clientServiceId: string;
  period: string;
  stage: WorkStage;
  doneBy?: string;
  doneAt?: string;
}

export interface PeriodCount {
  clientServiceId: string;
  period: string;
  processed: number;
  expected: number;
}

export interface TimeEntry {
  id: string;
  who: string;
  clientId?: string;
  clientServiceId?: string;
  task?: string;
  startedAt?: string;
  seconds: number;
  note?: string;
  edited: boolean;
  editedBy?: string;
  editedAt?: string;
}

export interface Credential {
  id: string;
  clientId?: string;
  groupLabel?: string;
  portal: string;
  username?: string;
  vaultRef?: string;
  isBank: boolean;
  linkUrl?: string;
  notes?: string;
}

export interface ClientStats {
  total: number;
  business: number;
  personal: number;
  monthlyFinancials: number;
  behindThisMonth: number;
  financialsCount: number;
  payrollCount: number;
  salesTaxCount: number;
  t9Count: number;
  renditionsCount: number;
  taxReturnsCount: number;
  annualReportsCount: number;
}

export interface StaffMember {
  id: string;
  name: string;
  initials: string;
  role: string;
}

export interface VaultEntry {
  id: string;
  site: string;
  service?: string;
  url?: string;
  email?: string;
  password?: string;
  notes?: string;
  clientId?: string;
  isBank?: boolean;
  groupLabel?: string;
  purpose?: string;
  additionalInfo01?: string;
  additionalInfo02?: string;
}
