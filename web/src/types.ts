export type EntryKind = "income" | "expense" | "refund";
export type EntryStatus = "posted" | "pending" | "refunded" | "void";
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
}

export interface LedgerEntry {
  id: string;
  kind: EntryKind;
  status: EntryStatus;
  description: string;
  amount: number;
  occurredOn: string;
  categoryId: string | null;
  counterparty: string;
  paymentMethod: string;
  note: string;
  attachments: Attachment[];
  createdAt: string;
  updatedAt: string;
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
}
