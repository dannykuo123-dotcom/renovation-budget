export type EntryKind = "income" | "expense" | "refund";
export type EntryStatus = "posted" | "pending" | "void";
export type TransferStatus = "posted" | "pending" | "void";
export type ProjectStatus = "active" | "completed" | "archived";

export interface Attachment {
  id: string;
  entryId: string;
  filename: string;
  contentType: string;
  size: number;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  plannedAmount: number;
  color: string;
  sortOrder: number;
  items: BudgetItem[];
}

export interface BudgetItem {
  id: string;
  name: string;
  plannedAmount: number;
  sortOrder: number;
}

export interface LedgerEntry {
  id: string;
  kind: EntryKind;
  status: EntryStatus;
  refundOfEntryId: string | null;
  description: string;
  amount: number;
  occurredOn: string;
  categoryId: string | null;
  personId: string | null;
  counterparty: string;
  paymentMethod: string;
  note: string;
  attachments: Attachment[];
  createdAt: string;
  updatedAt: string;
}


export interface Person {
  id: string;
  name: string;
  role: string;
  note: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FundTransfer {
  id: string;
  fromPersonId: string;
  toPersonId: string;
  amount: number;
  occurredOn: string;
  status: TransferStatus;
  paymentMethod: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersonCashflowSummary {
  person: Person;
  received: number;
  paid: number;
  pendingReceive: number;
  pendingPay: number;
  net: number;
}
export interface Project {
  id: string;
  name: string;
  address: string;
  status: ProjectStatus;
  currency: "TWD";
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary extends Project {
  planned: number;
  received: number;
  spent: number;
  pending: number;
}

export interface DashboardPayload {
  project: Project;
  categories: Category[];
  entries: LedgerEntry[];
  people: Person[];
  transfers: FundTransfer[];
}
