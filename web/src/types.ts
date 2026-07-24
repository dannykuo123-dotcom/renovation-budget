export type EntryKind = "income" | "expense" | "refund";
export type EntryStatus = "posted" | "pending" | "void";

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

export interface ProjectSettings {
  name: string;
  currency: "TWD";
  updatedAt: string;
}

export interface DashboardPayload {
  project: ProjectSettings;
  categories: Category[];
  entries: LedgerEntry[];
}
