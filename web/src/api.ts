import { calculateTotals } from "./finance";
import type {
  BudgetItem,
  BudgetSpace,
  Category,
  DashboardPayload,
  EntryKind,
  EntryStatus,
  LedgerEntry,
  Project,
  ProjectStatus,
  ProjectSummary,
  FundTransfer,
  Person,
  TransferStatus,
} from "./types";

const configuredBase = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "");
const tokenKey = "rainbow-electric-token";
export const isDemoMode = !configuredBase;
const now = () => new Date().toISOString();

const demoProjects: Project[] = [];
const demoDashboards = new Map<string, DashboardPayload>();

export interface ProjectInput {
  name: string;
  address: string;
  status: ProjectStatus;
}

export interface EntryInput {
  kind: EntryKind;
  status: EntryStatus;
  description: string;
  personId: string | null;
  amount: number;
  occurredOn: string;
  categoryId: string | null;
  counterparty: string;
  paymentMethod: string;
  note: string;
}

export interface CategoryInput {
  name: string;
  color: string;
}

export interface BudgetSpaceInput {
  name: string;
}

export interface BudgetItemInput {
  spaceId: string;
  categoryId: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface PersonInput {
  name: string;
  role: string;
  note: string;
  active: boolean;
}

export interface TransferInput {
  fromPersonId: string;
  toPersonId: string;
  amount: number;
  occurredOn: string;
  status: TransferStatus;
  paymentMethod: string;
  note: string;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export const session = {
  get token() {
    return sessionStorage.getItem(tokenKey);
  },
  set token(value: string | null) {
    value ? sessionStorage.setItem(tokenKey, value) : sessionStorage.removeItem(tokenKey);
  },
};

const clone = <T>(value: T): T => structuredClone(value);

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (session.token) headers.set("Authorization", `Bearer ${session.token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(`${configuredBase}${path}`, { ...init, headers });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "服務暫時無法使用" }));
    throw new ApiError(error.error || "操作失敗", response.status);
  }
  return response.status === 204 ? (undefined as T) : response.json() as Promise<T>;
}

export async function login(code: string): Promise<void> {
  if (isDemoMode) {
    if (!code.trim()) throw new Error("請輸入任意代碼以開啟本機模式");
    session.token = "demo-session";
    return;
  }
  const result = await request<{ token: string }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
  session.token = result.token;
}

function demoProjectSummary(project: Project): ProjectSummary {
  const dashboard = demoDashboards.get(project.id)!;
  const totals = calculateTotals(dashboard.spaces, dashboard.entries);
  return { ...project, planned: totals.planned, received: totals.received, spent: totals.spent, pending: totals.pending };
}

export async function loadProjects(): Promise<ProjectSummary[]> {
  if (isDemoMode) {
    return clone(
      demoProjects
        .map(demoProjectSummary)
        .sort((a, b) => a.status.localeCompare(b.status) || b.updatedAt.localeCompare(a.updatedAt)),
    );
  }
  return request<ProjectSummary[]>("/api/projects");
}

export async function createProject(input: ProjectInput): Promise<Project> {
  if (isDemoMode) {
    const timestamp = now();
    const project: Project = {
      id: crypto.randomUUID(),
      ...input,
      currency: "TWD",
      ownerBudget: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    demoProjects.push(project);
    demoDashboards.set(project.id, { project, categories: [], spaces: [{ id: crypto.randomUUID(), name: "未分空間", sortOrder: 1, items: [] }], entries: [], people: [], transfers: [] });
    return clone(project);
  }
  return request<Project>("/api/projects", { method: "POST", body: JSON.stringify(input) });
}

export async function updateProject(projectId: string, input: ProjectInput): Promise<Project> {
  if (isDemoMode) {
    const project = demoProjects.find((item) => item.id === projectId);
    if (!project) throw new Error("找不到此工程案");
    Object.assign(project, input, { updatedAt: now() });
    demoDashboards.get(projectId)!.project = project;
    return clone(project);
  }
  return request<Project>(`/api/projects/${projectId}`, { method: "PATCH", body: JSON.stringify(input) });
}

export async function saveOwnerBudget(projectId: string, ownerBudget: number): Promise<Project> {
  if (isDemoMode) {
    const project = demoProjects.find((item) => item.id === projectId);
    if (!project) throw new Error("找不到此工程案");
    project.ownerBudget = ownerBudget;
    project.updatedAt = now();
    demoDashboards.get(projectId)!.project = project;
    return clone(project);
  }
  return request<Project>(`/api/projects/${projectId}/owner-budget`, {
    method: "PATCH",
    body: JSON.stringify({ ownerBudget }),
  });
}

export async function setProjectArchived(projectId: string, archived: boolean): Promise<Project> {
  if (isDemoMode) {
    const project = demoProjects.find((item) => item.id === projectId);
    if (!project) throw new Error("找不到此工程案");
    project.status = archived ? "archived" : "active";
    project.updatedAt = now();
    return clone(project);
  }
  return request<Project>(`/api/projects/${projectId}/${archived ? "archive" : "restore"}`, { method: "POST" });
}

export async function loadDashboard(projectId: string): Promise<DashboardPayload> {
  if (isDemoMode) {
    const dashboard = demoDashboards.get(projectId);
    if (!dashboard) throw new ApiError("找不到此工程案", 404);
    return clone(dashboard);
  }
  return request<DashboardPayload>(`/api/projects/${projectId}/dashboard`);
}

function touchDemo(projectId: string) {
  const project = demoProjects.find((item) => item.id === projectId);
  if (project) {
    project.updatedAt = now();
    const dashboard = demoDashboards.get(projectId);
    if (dashboard) dashboard.project = project;
  }
}

export async function saveCategory(
  projectId: string,
  input: CategoryInput,
  categoryId?: string,
): Promise<Category> {
  if (isDemoMode) {
    const dashboard = demoDashboards.get(projectId)!;
    if (categoryId) {
      const category = dashboard.categories.find((item) => item.id === categoryId);
      if (!category) throw new Error("找不到此分類");
      Object.assign(category, input);
      touchDemo(projectId);
      return clone(category);
    }
    const category: Category = {
      id: crypto.randomUUID(),
      ...input,
      sortOrder: dashboard.categories.length + 1,
    };
    dashboard.categories.push(category);
    touchDemo(projectId);
    return clone(category);
  }
  const path = `/api/projects/${projectId}/categories${categoryId ? `/${categoryId}` : ""}`;
  return request<Category>(path, {
    method: categoryId ? "PATCH" : "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteCategory(projectId: string, categoryId: string): Promise<void> {
  if (isDemoMode) {
    const dashboard = demoDashboards.get(projectId)!;
    if (dashboard.entries.some((entry) => entry.categoryId === categoryId) ||
      dashboard.spaces.some((space) => space.items.some((item) => item.categoryId === categoryId))) {
      throw new Error("此分類已有帳務或預算項目，請先重新分類相關紀錄。");
    }
    dashboard.categories = dashboard.categories.filter((item) => item.id !== categoryId);
    touchDemo(projectId);
    return;
  }
  await request<void>(`/api/projects/${projectId}/categories/${categoryId}`, { method: "DELETE" });
}


export async function saveBudgetSpace(
  projectId: string,
  input: BudgetSpaceInput,
  spaceId?: string,
): Promise<BudgetSpace> {
  if (isDemoMode) {
    const dashboard = demoDashboards.get(projectId)!;
    const duplicate = dashboard.spaces.find((space) => space.name.localeCompare(input.name, "zh-Hant", { sensitivity: "accent" }) === 0 && space.id !== spaceId);
    if (duplicate) throw new Error("已有相同名稱的空間");
    if (spaceId) {
      const space = dashboard.spaces.find((item) => item.id === spaceId);
      if (!space) throw new Error("找不到此空間");
      space.name = input.name;
      touchDemo(projectId);
      return clone(space);
    }
    const space: BudgetSpace = { id: crypto.randomUUID(), name: input.name, sortOrder: dashboard.spaces.length + 1, items: [] };
    dashboard.spaces.push(space);
    touchDemo(projectId);
    return clone(space);
  }
  const path = `/api/projects/${projectId}/budget-spaces${spaceId ? `/${spaceId}` : ""}`;
  return request<BudgetSpace>(path, { method: spaceId ? "PATCH" : "POST", body: JSON.stringify(input) });
}

export async function deleteBudgetSpace(projectId: string, spaceId: string): Promise<void> {
  if (isDemoMode) {
    const dashboard = demoDashboards.get(projectId)!;
    const space = dashboard.spaces.find((item) => item.id === spaceId);
    if (space?.items.length) throw new Error("此空間仍有預算項目，請先移動或刪除項目。");
    dashboard.spaces = dashboard.spaces.filter((item) => item.id !== spaceId);
    touchDemo(projectId);
    return;
  }
  await request<void>(`/api/projects/${projectId}/budget-spaces/${spaceId}`, { method: "DELETE" });
}

export async function saveBudgetItem(
  projectId: string,
  input: BudgetItemInput,
  itemId?: string,
): Promise<BudgetItem> {
  if (isDemoMode) {
    const dashboard = demoDashboards.get(projectId)!;
    const targetSpace = dashboard.spaces.find((space) => space.id === input.spaceId);
    if (!targetSpace) throw new Error("請選擇空間");
    if (input.categoryId && !dashboard.categories.some((category) => category.id === input.categoryId)) throw new Error("分類不存在");
    const plannedAmount = input.quantity * input.unitPrice;
    if (itemId) {
      const sourceSpace = dashboard.spaces.find((space) => space.items.some((item) => item.id === itemId));
      const item = sourceSpace?.items.find((candidate) => candidate.id === itemId);
      if (!item || !sourceSpace) throw new Error("找不到此預算項目");
      if (sourceSpace.id !== targetSpace.id) sourceSpace.items = sourceSpace.items.filter((candidate) => candidate.id !== itemId);
      Object.assign(item, input, { plannedAmount });
      if (sourceSpace.id !== targetSpace.id) {
        item.sortOrder = targetSpace.items.length + 1;
        targetSpace.items.push(item);
      }
      touchDemo(projectId);
      return clone(item);
    }
    const item: BudgetItem = { id: crypto.randomUUID(), ...input, plannedAmount, sortOrder: targetSpace.items.length + 1 };
    targetSpace.items.push(item);
    touchDemo(projectId);
    return clone(item);
  }
  const path = `/api/projects/${projectId}/budget-items${itemId ? `/${itemId}` : ""}`;
  return request<BudgetItem>(path, { method: itemId ? "PATCH" : "POST", body: JSON.stringify(input) });
}

export async function deleteBudgetItem(projectId: string, itemId: string): Promise<void> {
  if (isDemoMode) {
    const dashboard = demoDashboards.get(projectId)!;
    dashboard.spaces.forEach((space) => { space.items = space.items.filter((item) => item.id !== itemId); });
    touchDemo(projectId);
    return;
  }
  await request<void>(`/api/projects/${projectId}/budget-items/${itemId}`, { method: "DELETE" });
}

export async function clearBudgetItems(projectId: string): Promise<void> {
  if (isDemoMode) {
    const dashboard = demoDashboards.get(projectId);
    if (!dashboard) throw new Error("找不到此工程案");
    dashboard.spaces.forEach((space) => { space.items = []; });
    touchDemo(projectId);
    return;
  }
  await request<void>(`/api/projects/${projectId}/budget-items`, { method: "DELETE" });
}

export async function savePerson(projectId: string, input: PersonInput, personId?: string): Promise<Person> {
  if (isDemoMode) {
    const dashboard = demoDashboards.get(projectId)!;
    const duplicate = dashboard.people.find((person) => person.name.localeCompare(input.name, "zh-Hant", { sensitivity: "accent" }) === 0 && person.id !== personId);
    if (duplicate) throw new Error("同一工程內的人員名稱不可重複");
    if (personId) {
      const person = dashboard.people.find((item) => item.id === personId);
      if (!person) throw new Error("找不到此人員");
      Object.assign(person, input, { updatedAt: now() });
      touchDemo(projectId);
      return clone(person);
    }
    const timestamp = now();
    const person: Person = { id: crypto.randomUUID(), ...input, createdAt: timestamp, updatedAt: timestamp };
    dashboard.people.push(person);
    touchDemo(projectId);
    return clone(person);
  }
  const path = `/api/projects/${projectId}/people${personId ? `/${personId}` : ""}`;
  return request<Person>(path, { method: personId ? "PATCH" : "POST", body: JSON.stringify(input) });
}

export async function deletePerson(projectId: string, personId: string): Promise<void> {
  if (isDemoMode) {
    const dashboard = demoDashboards.get(projectId)!;
    if (dashboard.entries.some((entry) => entry.personId === personId) ||
      dashboard.transfers.some((transfer) => transfer.fromPersonId === personId || transfer.toPersonId === personId)) {
      throw new Error("已被帳務或移轉引用的人員只能停用");
    }
    dashboard.people = dashboard.people.filter((person) => person.id !== personId);
    touchDemo(projectId);
    return;
  }
  await request<void>(`/api/projects/${projectId}/people/${personId}`, { method: "DELETE" });
}

export async function saveTransfer(projectId: string, input: TransferInput, transferId?: string): Promise<FundTransfer> {
  if (isDemoMode) {
    const dashboard = demoDashboards.get(projectId)!;
    const validPeople = new Set(dashboard.people.filter((person) => person.active).map((person) => person.id));
    if (input.fromPersonId === input.toPersonId || !validPeople.has(input.fromPersonId) || !validPeople.has(input.toPersonId)) {
      throw new Error("轉出人與轉入人必須是不同的啟用人員");
    }
    if (transferId) {
      const transfer = dashboard.transfers.find((item) => item.id === transferId);
      if (!transfer) throw new Error("找不到此資金移轉");
      Object.assign(transfer, input, { updatedAt: now() });
      touchDemo(projectId);
      return clone(transfer);
    }
    const timestamp = now();
    const transfer: FundTransfer = { id: crypto.randomUUID(), ...input, createdAt: timestamp, updatedAt: timestamp };
    dashboard.transfers.unshift(transfer);
    touchDemo(projectId);
    return clone(transfer);
  }
  const path = `/api/projects/${projectId}/transfers${transferId ? `/${transferId}` : ""}`;
  return request<FundTransfer>(path, { method: transferId ? "PATCH" : "POST", body: JSON.stringify(input) });
}

export async function deleteTransfer(projectId: string, transferId: string): Promise<void> {
  if (isDemoMode) {
    const dashboard = demoDashboards.get(projectId)!;
    dashboard.transfers = dashboard.transfers.filter((item) => item.id !== transferId);
    touchDemo(projectId);
    return;
  }
  await request<void>(`/api/projects/${projectId}/transfers/${transferId}`, { method: "DELETE" });
}


export async function saveEntry(
  projectId: string,
  input: EntryInput,
  entryId?: string,
): Promise<LedgerEntry> {
  if (isDemoMode) {
    const dashboard = demoDashboards.get(projectId)!;
    const person = dashboard.people.find((item) => item.id === input.personId && item.active);
    if (!person) throw new Error("請選擇啟用中的人員");
    const resolved = { ...input, personId: person.id, counterparty: person.name };
    if (entryId) {
      const item = dashboard.entries.find((entry) => entry.id === entryId)!;
      Object.assign(item, resolved, { updatedAt: now() });
      touchDemo(projectId);
      return clone(item);
    }
    const item: LedgerEntry = {
      ...resolved,
      id: crypto.randomUUID(),
      attachments: [],
      createdAt: now(),
      updatedAt: now(),
    };
    dashboard.entries.unshift(item);
    touchDemo(projectId);
    return clone(item);
  }
  const path = `/api/projects/${projectId}/entries${entryId ? `/${entryId}` : ""}`;
  return request<LedgerEntry>(path, {
    method: entryId ? "PATCH" : "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteEntry(projectId: string, entryId: string): Promise<void> {
  if (isDemoMode) {
    const dashboard = demoDashboards.get(projectId)!;
    dashboard.entries = dashboard.entries.filter((item) => item.id !== entryId);
    touchDemo(projectId);
    return;
  }
  await request<void>(`/api/projects/${projectId}/entries/${entryId}`, { method: "DELETE" });
}

export async function uploadAttachments(projectId: string, entryId: string, files: File[]): Promise<void> {
  if (!files.length || isDemoMode) return;
  for (const file of files) {
    const form = new FormData();
    form.set("file", file);
    await request(`/api/projects/${projectId}/entries/${entryId}/attachments`, {
      method: "POST",
      body: form,
    });
  }
}

export async function downloadProjectCsv(projectId: string, projectName: string): Promise<void> {
  if (isDemoMode) {
    const dashboard = demoDashboards.get(projectId)!;
    const rows = [
      ["日期", "類型", "品項", "分類", "金額", "狀態", "對象", "付款方式", "備註"],
      ...dashboard.entries.map((entry) => [
        entry.occurredOn,
        entry.kind,
        entry.description,
        dashboard.categories.find((category) => category.id === entry.categoryId)?.name ?? "",
        String(entry.amount),
        entry.status,
        entry.counterparty,
        entry.paymentMethod,
        entry.note,
      ]),
    ];
    saveCsv(rows, projectName);
    return;
  }
  const response = await fetch(`${configuredBase}/api/projects/${projectId}/export.csv`, {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "下載失敗" }));
    throw new ApiError(error.error || "下載失敗", response.status);
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `${projectName}-帳務.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
export async function downloadCashflowCsv(projectId: string, projectName: string): Promise<void> {
  if (isDemoMode) {
    const dashboard = demoDashboards.get(projectId)!;
    const person = (id: string | null) => dashboard.people.find((item) => item.id === id);
    const transferRows = dashboard.transfers.map((transfer) => {
      const from = person(transfer.fromPersonId);
      const to = person(transfer.toPersonId);
      const status = transfer.status === "posted" ? "已完成" : transfer.status === "pending" ? "待處理" : "已作廢";
      return [transfer.occurredOn, from?.name ?? "", to?.name ?? "", status, String(transfer.amount), transfer.paymentMethod, transfer.note];
    });
    saveCsv([["日期", "轉出人", "轉入人", "狀態", "金額", "付款方式", "備註"], ...transferRows], `${projectName}-資金移轉`);
    return;
  }
  const response = await fetch(`${configuredBase}/api/projects/${projectId}/cashflow/export.csv`, {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "下載失敗" }));
    throw new ApiError(error.error || "下載失敗", response.status);
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `${projectName}-資金移轉.csv`;
  link.click();
  URL.revokeObjectURL(url);
}



function saveCsv(rows: string[][], projectName: string) {
  const csv = "\uFEFF" + rows
    .map((row) => row.map((item) => `"${item.replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${projectName}-帳務.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
