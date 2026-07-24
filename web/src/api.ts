import type { Category, DashboardPayload, EntryKind, EntryStatus, LedgerEntry } from "./types";

const configuredBase = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "");
const tokenKey = "renovation-budget-token";
export const isDemoMode = !configuredBase;

const now = () => new Date().toISOString();
const demoPayload: DashboardPayload = {
  project: { name: "沐光宅整修計畫", currency: "TWD", updatedAt: now() },
  categories: [
    { id: "construction", name: "施工", plannedAmount: 180000, color: "#1d6f63", sortOrder: 1 },
    { id: "materials", name: "材料", plannedAmount: 120000, color: "#6d5bd0", sortOrder: 2 },
    { id: "tools", name: "工具", plannedAmount: 30000, color: "#d8823e", sortOrder: 3 },
    { id: "other", name: "其他", plannedAmount: 20000, color: "#527fbd", sortOrder: 4 },
  ],
  entries: [
    { id: "income-1", kind: "income", status: "posted", description: "第一筆裝修款", amount: 100000, occurredOn: "2026-07-14", categoryId: null, counterparty: "共同出資人", paymentMethod: "銀行轉帳", note: "已入帳", attachments: [], createdAt: now(), updatedAt: now() },
    { id: "expense-1", kind: "expense", status: "posted", description: "隔間門工程", amount: 22000, occurredOn: "2026-07-12", categoryId: "construction", counterparty: "永盛工程", paymentMethod: "銀行轉帳", note: "施工第一期", attachments: [], createdAt: now(), updatedAt: now() },
    { id: "expense-2", kind: "expense", status: "posted", description: "木地板訂金", amount: 35000, occurredOn: "2026-07-13", categoryId: "materials", counterparty: "木作工坊", paymentMethod: "信用卡", note: "", attachments: [], createdAt: now(), updatedAt: now() },
    { id: "expense-3", kind: "expense", status: "pending", description: "廚房設備", amount: 20000, occurredOn: "2026-07-20", categoryId: "materials", counterparty: "居家廚具", paymentMethod: "轉帳", note: "待確認報價", attachments: [], createdAt: now(), updatedAt: now() },
  ],
};

const clone = <T>(value: T): T => structuredClone(value);
let demoState = clone(demoPayload);

export interface EntryInput {
  kind: EntryKind;
  status: EntryStatus;
  description: string;
  amount: number;
  occurredOn: string;
  categoryId: string | null;
  counterparty: string;
  paymentMethod: string;
  note: string;
}

export const session = {
  get token() { return sessionStorage.getItem(tokenKey); },
  set token(value: string | null) { value ? sessionStorage.setItem(tokenKey, value) : sessionStorage.removeItem(tokenKey); },
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (session.token) headers.set("Authorization", `Bearer ${session.token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(`${configuredBase}${path}`, { ...init, headers });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "服務暫時無法使用" }));
    throw new Error(error.error || "操作失敗");
  }
  return response.status === 204 ? (undefined as T) : response.json() as Promise<T>;
}

export async function login(code: string): Promise<void> {
  if (isDemoMode) {
    if (!code.trim()) throw new Error("請輸入任意代碼以開啟範例模式");
    session.token = "demo-session";
    return;
  }
  const result = await request<{ token: string }>("/api/auth/login", { method: "POST", body: JSON.stringify({ code }) });
  session.token = result.token;
}

export async function loadDashboard(): Promise<DashboardPayload> {
  if (isDemoMode) return clone(demoState);
  return request<DashboardPayload>("/api/dashboard");
}

export async function saveProjectName(name: string): Promise<DashboardPayload["project"]> {
  if (isDemoMode) {
    demoState.project = { ...demoState.project, name, updatedAt: now() };
    return clone(demoState.project);
  }
  return request<DashboardPayload["project"]>("/api/project", { method: "PATCH", body: JSON.stringify({ name }) });
}

export async function saveCategory(input: Omit<Category, "id" | "sortOrder">, id?: string): Promise<Category> {
  if (isDemoMode) {
    if (id) {
      const item = demoState.categories.find((category) => category.id === id)!;
      Object.assign(item, input);
      return clone(item);
    }
    const item = { ...input, id: crypto.randomUUID(), sortOrder: demoState.categories.length + 1 };
    demoState.categories.push(item);
    return clone(item);
  }
  return request<Category>(id ? `/api/categories/${id}` : "/api/categories", { method: id ? "PATCH" : "POST", body: JSON.stringify(input) });
}

export async function deleteCategory(id: string): Promise<void> {
  if (isDemoMode) { demoState.categories = demoState.categories.filter((item) => item.id !== id); return; }
  await request<void>(`/api/categories/${id}`, { method: "DELETE" });
}

export async function saveEntry(input: EntryInput, id?: string): Promise<LedgerEntry> {
  if (isDemoMode) {
    if (id) {
      const item = demoState.entries.find((entry) => entry.id === id)!;
      Object.assign(item, input, { updatedAt: now() });
      return clone(item);
    }
    const item: LedgerEntry = { ...input, id: crypto.randomUUID(), attachments: [], createdAt: now(), updatedAt: now() };
    demoState.entries.unshift(item);
    return clone(item);
  }
  return request<LedgerEntry>(id ? `/api/entries/${id}` : "/api/entries", { method: id ? "PATCH" : "POST", body: JSON.stringify(input) });
}

export async function deleteEntry(id: string): Promise<void> {
  if (isDemoMode) { demoState.entries = demoState.entries.filter((item) => item.id !== id); return; }
  await request<void>(`/api/entries/${id}`, { method: "DELETE" });
}

export async function uploadAttachments(entryId: string, files: File[]): Promise<void> {
  if (!files.length || isDemoMode) return;
  for (const file of files) {
    const form = new FormData();
    form.set("file", file);
    await request(`/api/entries/${entryId}/attachments`, { method: "POST", body: form });
  }
}

export async function clearDemo(): Promise<void> {
  if (!isDemoMode) throw new Error("正式環境請逐筆刪除資料，避免誤清空共用帳務。");
  demoState = { project: { ...demoPayload.project, updatedAt: now() }, categories: [], entries: [] };
}

export function exportUrl(): string {
  return isDemoMode ? "" : `${configuredBase}/api/export.csv`;
}
