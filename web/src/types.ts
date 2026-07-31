export type EntryKind = "income" | "expense";
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
  color: string;
  sortOrder: number;
}

export interface BudgetItem {
  id: string;
  spaceId: string;
  categoryId: string | null;
  name: string;
  plannedAmount: number;
  quantity: number;
  unitPrice: number;
  sortOrder: number;
}

export interface BudgetSpace {
  id: string;
  name: string;
  sortOrder: number;
  items: BudgetItem[];
}

export interface LedgerEntry {
  id: string;
  kind: EntryKind;
  status: EntryStatus;
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

export interface Project {
  id: string;
  name: string;
  address: string;
  status: ProjectStatus;
  currency: "TWD";
  ownerBudget: number;
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
  spaces: BudgetSpace[];
}
