export interface Env {
  DB: D1Database;
  RECEIPTS: R2Bucket;
  ALLOWED_ORIGIN: string;
  BUDGET_ACCESS_CODE: string;
  SESSION_SIGNING_SECRET: string;
}

type EntryKind = "income" | "expense" | "refund";
type EntryStatus = "posted" | "pending" | "void";
type TransferStatus = "posted" | "pending" | "void";
type ProjectStatus = "active" | "completed" | "archived";
type EntryInput = {
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
};
type PersonInput = {
  name: string;
  role: string;
  note: string;
  active: boolean;
};
type TransferInput = {
  fromPersonId: string;
  toPersonId: string;
  amount: number;
  occurredOn: string;
  status: TransferStatus;
  paymentMethod: string;
  note: string;
};
type BudgetItemInput = {
  name: string;
  plannedAmount: number;
};

const encoder = new TextEncoder();
const now = () => new Date().toISOString();
const newId = () => crypto.randomUUID();
const json = (value: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(value), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers ?? {}) },
  });
const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

function cors(request: Request, env: Env): Headers {
  const headers = new Headers({ Vary: "Origin" });
  const origin = request.headers.get("Origin");
  if (origin && origin === env.ALLOWED_ORIGIN) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  }
  return headers;
}

function withCors(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  cors(request, env).forEach((value, key) => headers.set(key, value));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function isAllowedOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  return !origin || origin === env.ALLOWED_ORIGIN;
}

async function digest(value: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

async function issueToken(env: Env): Promise<string> {
  const payload = base64Url(encoder.encode(JSON.stringify({ exp: Date.now() + 12 * 60 * 60 * 1000, v: 1 })));
  return `${payload}.${await sign(payload, env.SESSION_SIGNING_SECRET)}`;
}

async function hasSession(request: Request, env: Env): Promise<boolean> {
  const bearer = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!bearer) return false;
  const [payload, signature] = bearer.split(".");
  if (!payload || !signature || !safeEqual(signature, await sign(payload, env.SESSION_SIGNING_SECRET))) return false;
  try {
    const padded = payload.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const decoded = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))),
    ) as { exp?: number };
    return typeof decoded.exp === "number" && decoded.exp > Date.now();
  } catch {
    return false;
  }
}

async function requireJson(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("請提供正確的 JSON 資料");
  return body as Record<string, unknown>;
}

function text(value: unknown, limit: number): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function parseMoney(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function parseBudgetItems(value: unknown): BudgetItemInput[] | null {
  if (!Array.isArray(value) || value.length > 80) return null;
  const items: BudgetItemInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const detail = item as Record<string, unknown>;
    const name = text(detail.name, 60);
    const plannedAmount = detail.plannedAmount;
    if (!name || typeof plannedAmount !== "number" || !Number.isSafeInteger(plannedAmount) || plannedAmount < 0) {
      return null;
    }
    items.push({ name, plannedAmount });
  }
  return items;
}

function parseProject(input: Record<string, unknown>) {
  const name = text(input.name, 60);
  const address = text(input.address, 160);
  const status = String(input.status ?? "active");
  if (!name) throw new Error("請輸入工程案名稱");
  if (!["active", "completed", "archived"].includes(status)) throw new Error("工程案狀態不正確");
  return { name, address, status: status as ProjectStatus };
}

function parseEntry(input: Record<string, unknown>): EntryInput {
  const kind = input.kind;
  const status = input.status;
  const amount = parseMoney(input.amount);
  const occurredOn = text(input.occurredOn, 10);
  if (
    !["income", "expense", "refund"].includes(String(kind)) ||
    !["posted", "pending"].includes(String(status)) ||
    !amount ||
    !/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)
  ) {
    throw new Error("紀錄資料不完整或格式錯誤");
  }
  const description = text(input.description, 80);
  if (!description) throw new Error("請輸入品項或用途");
  if (kind === "income" && status !== "posted") throw new Error("資金入帳只能標記為已入帳");
  if (kind === "expense" && status !== "posted") throw new Error("支出只能標記為已付款");
  const refundOfEntryId = text(input.refundOfEntryId, 80) || null;
  if (kind === "refund" && !refundOfEntryId) throw new Error("請選擇原始支出紀錄");
  if (kind !== "refund" && refundOfEntryId) throw new Error("只有退款紀錄可以連結原始支出");
  return {
    kind: kind as EntryKind,
    status: status as EntryStatus,
    refundOfEntryId,
    description,
    amount,
    occurredOn,
    categoryId: typeof input.categoryId === "string" && input.categoryId ? input.categoryId : null,
    personId: text(input.personId, 80) || null,
    counterparty: text(input.counterparty, 60),
    paymentMethod: text(input.paymentMethod, 30),
    note: text(input.note, 500),
  };
}

function parsePerson(input: Record<string, unknown>): PersonInput {
  const name = text(input.name, 60);
  if (!name) throw new Error("請輸入人員姓名或名稱");
  return {
    name,
    role: text(input.role, 40),
    note: text(input.note, 500),
    active: input.active !== false,
  };
}

function parseTransfer(input: Record<string, unknown>): TransferInput {
  const amount = parseMoney(input.amount);
  const occurredOn = text(input.occurredOn, 10);
  const status = String(input.status);
  const fromPersonId = text(input.fromPersonId, 80);
  const toPersonId = text(input.toPersonId, 80);
  if (!amount || !/^\d{4}-\d{2}-\d{2}$/.test(occurredOn) || !["posted", "pending"].includes(status)) {
    throw new Error("移轉金額、日期或狀態格式不正確");
  }
  if (!fromPersonId || !toPersonId || fromPersonId === toPersonId) {
    throw new Error("請選擇不同的出款人與收款人");
  }
  return {
    fromPersonId,
    toPersonId,
    amount,
    occurredOn,
    status: status as TransferStatus,
    paymentMethod: text(input.paymentMethod, 30),
    note: text(input.note, 500),
  };
}
async function rateLimit(request: Request, env: Env): Promise<boolean> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const ipHash = await digest(`${ip}:${env.SESSION_SIGNING_SECRET}`);
  const current = await env.DB.prepare(
    "SELECT attempts, window_started_at FROM login_attempts WHERE ip_hash = ?",
  ).bind(ipHash).first<{ attempts: number; window_started_at: number }>();
  return !(current && Date.now() - current.window_started_at < 15 * 60 * 1000 && current.attempts >= 5);
}

async function recordFailure(request: Request, env: Env): Promise<void> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const ipHash = await digest(`${ip}:${env.SESSION_SIGNING_SECRET}`);
  const timestamp = Date.now();
  const current = await env.DB.prepare(
    "SELECT attempts, window_started_at FROM login_attempts WHERE ip_hash = ?",
  ).bind(ipHash).first<{ attempts: number; window_started_at: number }>();
  if (!current || timestamp - current.window_started_at >= 15 * 60 * 1000) {
    await env.DB.prepare(
      "INSERT OR REPLACE INTO login_attempts (ip_hash, attempts, window_started_at) VALUES (?, ?, ?)",
    ).bind(ipHash, 1, timestamp).run();
  } else {
    await env.DB.prepare("UPDATE login_attempts SET attempts = attempts + 1 WHERE ip_hash = ?").bind(ipHash).run();
  }
}

async function clearFailures(request: Request, env: Env): Promise<void> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const ipHash = await digest(`${ip}:${env.SESSION_SIGNING_SECRET}`);
  await env.DB.prepare("DELETE FROM login_attempts WHERE ip_hash = ?").bind(ipHash).run();
}

async function cleanupLegacyAttachments(env: Env): Promise<number> {
  const result = await env.DB.prepare("SELECT object_key FROM legacy_attachment_cleanup").all<{ object_key: string }>();
  if (!result.results.length) return 0;
  for (let index = 0; index < result.results.length; index += 1000) {
    await env.RECEIPTS.delete(result.results.slice(index, index + 1000).map((item) => item.object_key));
  }
  await env.DB.prepare("DELETE FROM legacy_attachment_cleanup").run();
  return result.results.length;
}

const mapProject = (row: Record<string, unknown>) => ({
  id: row.id,
  name: row.name,
  address: row.address,
  status: row.status,
  currency: row.currency,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapProjectSummary = (row: Record<string, unknown>) => ({
  ...mapProject(row),
  planned: Number(row.planned ?? 0),
  received: Number(row.received ?? 0),
  spent: Number(row.spent ?? 0),
  pending: Number(row.pending ?? 0),
});

const mapBudgetItem = (row: Record<string, unknown>) => ({
  id: row.id,
  name: row.name,
  plannedAmount: row.planned_amount,
  sortOrder: row.sort_order,
});

const mapCategory = (row: Record<string, unknown>, items: Record<string, unknown>[] = []) => ({
  id: row.id,
  name: row.name,
  plannedAmount: row.planned_amount,
  color: row.color,
  sortOrder: row.sort_order,
  items: items.filter((item) => item.category_id === row.id).map(mapBudgetItem),
});

async function categoryWithItems(env: Env, projectId: string, categoryId: string): Promise<Record<string, unknown> | null> {
  const [category, itemResult] = await Promise.all([
    env.DB.prepare(
      "SELECT id, name, planned_amount, color, sort_order FROM budget_categories WHERE id = ? AND project_id = ?",
    ).bind(categoryId, projectId).first<Record<string, unknown>>(),
    env.DB.prepare(
      "SELECT id, category_id, name, planned_amount, sort_order FROM budget_line_items WHERE category_id = ? AND project_id = ? ORDER BY sort_order, name",
    ).bind(categoryId, projectId).all<Record<string, unknown>>(),
  ]);
  return category ? mapCategory(category, itemResult.results) : null;
}

async function replaceBudgetItems(
  env: Env,
  projectId: string,
  categoryId: string,
  items: BudgetItemInput[],
  timestamp: string,
): Promise<void> {
  await env.DB.prepare("DELETE FROM budget_line_items WHERE category_id = ? AND project_id = ?")
    .bind(categoryId, projectId).run();
  for (const [index, item] of items.entries()) {
    await env.DB.prepare(
      "INSERT INTO budget_line_items (id, project_id, category_id, name, planned_amount, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(newId(), projectId, categoryId, item.name, item.plannedAmount, index + 1, timestamp, timestamp).run();
  }
}

const mapAttachment = (row: Record<string, unknown>) => ({
  id: row.id,
  entryId: row.entry_id,
  filename: row.filename,
  contentType: row.content_type,
  size: row.size,
  createdAt: row.created_at,
});

const mapEntry = (row: Record<string, unknown>, attachments: Record<string, unknown>[]) => ({
  id: row.id,
  kind: row.kind,
  status: row.status,
  refundOfEntryId: row.refund_of_entry_id,
  description: row.description,
  amount: row.amount,
  occurredOn: row.occurred_on,
  categoryId: row.category_id,
  personId: row.person_id,
  counterparty: row.counterparty,
  paymentMethod: row.payment_method,
  note: row.note,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  attachments: attachments.filter((attachment) => attachment.entry_id === row.id).map(mapAttachment),
});

const mapPerson = (row: Record<string, unknown>) => ({
  id: row.id,
  name: row.name,
  role: row.role,
  note: row.note,
  active: Boolean(row.active),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapTransfer = (row: Record<string, unknown>) => ({
  id: row.id,
  fromPersonId: row.from_person_id,
  toPersonId: row.to_person_id,
  amount: row.amount,
  occurredOn: row.occurred_on,
  status: row.status,
  paymentMethod: row.payment_method,
  note: row.note,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

async function resolveEntryPerson(env: Env, projectId: string, input: EntryInput): Promise<EntryInput> {
  if (input.kind === "refund") return input;
  if (!input.personId) throw new Error("請選擇人員");
  const person = await env.DB.prepare(
    "SELECT id, name FROM people WHERE id = ? AND project_id = ? AND active = 1",
  ).bind(input.personId, projectId).first<{ id: string; name: string }>();
  if (!person) throw new Error("請選擇啟用中的人員");
  return { ...input, personId: person.id };
}

async function resolveTransferPeople(
  env: Env,
  projectId: string,
  input: TransferInput,
): Promise<TransferInput> {
  const result = await env.DB.prepare(
    "SELECT id FROM people WHERE project_id = ? AND active = 1 AND id IN (?, ?)",
  ).bind(projectId, input.fromPersonId, input.toPersonId).all<{ id: string }>();
  if (result.results.length !== 2) throw new Error("出款人與收款人必須是同工程案的啟用人員");
  return input;
}
async function validateRefundSource(
  env: Env,
  projectId: string,
  input: EntryInput,
  editingEntryId?: string,
): Promise<EntryInput> {
  if (input.kind !== "refund") return input;
  const source = await env.DB.prepare(`
    SELECT id, amount, category_id, person_id, counterparty
    FROM ledger_entries
    WHERE id = ? AND project_id = ? AND kind = 'expense' AND status = 'posted'
  `).bind(input.refundOfEntryId, projectId).first<{ id: string; amount: number; category_id: string | null; person_id: string | null; counterparty: string }>();
  if (!source) throw new Error("退款只能連結同工程案的一筆已付款支出");
  const reserved = await env.DB.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS amount
    FROM ledger_entries
    WHERE project_id = ? AND kind = 'refund' AND refund_of_entry_id = ?
      AND status IN ('posted', 'pending') AND id != ?
  `).bind(projectId, source.id, editingEntryId ?? "").first<{ amount: number }>();
  if ((reserved?.amount ?? 0) + input.amount > source.amount) {
    throw new Error("退款金額加上既有退款不可超過原始支出金額");
  }
  if (!source.person_id) throw new Error("原始支出未指定人員，無法建立退款");
  return { ...input, categoryId: source.category_id, personId: source.person_id, counterparty: source.counterparty };
}

async function validateExpenseChange(
  env: Env,
  projectId: string,
  entryId: string,
  input: EntryInput,
): Promise<void> {
  const linked = await env.DB.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS amount
    FROM ledger_entries
    WHERE project_id = ? AND kind = 'refund' AND refund_of_entry_id = ? AND status IN ('posted', 'pending')
  `).bind(projectId, entryId).first<{ amount: number }>();
  const refundedAmount = linked?.amount ?? 0;
  if (!refundedAmount) return;
  if (input.kind !== "expense" || input.status !== "posted") {
    throw new Error("已有退款的原始支出必須維持已付款狀態");
  }
  if (input.amount < refundedAmount) {
    throw new Error("原始支出金額不可低於已建立的退款合計");
  }
}

async function findProject(projectId: string, env: Env): Promise<Record<string, unknown> | null> {
  return env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(projectId).first<Record<string, unknown>>();
}

async function touchProject(projectId: string, env: Env): Promise<void> {
  await env.DB.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").bind(now(), projectId).run();
}

async function projectCollection(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET") {
    const result = await env.DB.prepare(`
      SELECT p.*,
        COALESCE((SELECT SUM(c.planned_amount) FROM budget_categories c WHERE c.project_id = p.id), 0) AS planned,
        COALESCE((SELECT SUM(e.amount) FROM ledger_entries e WHERE e.project_id = p.id AND e.kind = 'income' AND e.status = 'posted'), 0) AS received,
        COALESCE((SELECT SUM(CASE WHEN e.kind = 'expense' THEN e.amount WHEN e.kind = 'refund' THEN -e.amount ELSE 0 END)
          FROM ledger_entries e WHERE e.project_id = p.id AND e.status = 'posted'), 0) AS spent,
        COALESCE((SELECT SUM(e.amount) FROM ledger_entries e WHERE e.project_id = p.id AND e.kind = 'expense' AND e.status = 'pending'), 0) AS pending
      FROM projects p
      ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'completed' THEN 1 ELSE 2 END, p.updated_at DESC
    `).all<Record<string, unknown>>();
    return json(result.results.map(mapProjectSummary));
  }
  if (request.method === "POST") {
    const input = parseProject(await requireJson(request));
    const projectId = newId();
    const timestamp = now();
    await env.DB.prepare(
      "INSERT INTO projects (id, name, address, status, currency, created_at, updated_at) VALUES (?, ?, ?, ?, 'TWD', ?, ?)",
    ).bind(projectId, input.name, input.address, input.status, timestamp, timestamp).run();
    const project = await findProject(projectId, env);
    return json(mapProject(project!), { status: 201 });
  }
  return json({ error: "不支援的方法" }, { status: 405 });
}

async function projectItem(request: Request, env: Env, projectId: string): Promise<Response> {
  const project = await findProject(projectId, env);
  if (!project) return json({ error: "找不到此工程案" }, { status: 404 });
  if (request.method === "GET") return json(mapProject(project));
  if (request.method === "PATCH") {
    const input = parseProject(await requireJson(request));
    const timestamp = now();
    await env.DB.prepare(
      "UPDATE projects SET name = ?, address = ?, status = ?, updated_at = ? WHERE id = ?",
    ).bind(input.name, input.address, input.status, timestamp, projectId).run();
    return json(mapProject((await findProject(projectId, env))!));
  }
  return json({ error: "不支援的方法" }, { status: 405 });
}

async function setProjectStatus(env: Env, projectId: string, status: ProjectStatus): Promise<Response> {
  const result = await env.DB.prepare("UPDATE projects SET status = ?, updated_at = ? WHERE id = ?")
    .bind(status, now(), projectId).run();
  if (!result.meta.changes) return json({ error: "找不到此工程案" }, { status: 404 });
  return json(mapProject((await findProject(projectId, env))!));
}

async function dashboard(env: Env, projectId: string): Promise<Response> {
  const [project, categoryResult, itemResult, entryResult, attachmentResult, peopleResult, transferResult] = await Promise.all([
    findProject(projectId, env),
    env.DB.prepare(
      "SELECT id, name, planned_amount, color, sort_order FROM budget_categories WHERE project_id = ? ORDER BY sort_order, name",
    ).bind(projectId).all<Record<string, unknown>>(),
    env.DB.prepare(
      "SELECT id, category_id, name, planned_amount, sort_order FROM budget_line_items WHERE project_id = ? ORDER BY category_id, sort_order, name",
    ).bind(projectId).all<Record<string, unknown>>(),
    env.DB.prepare(
      "SELECT * FROM ledger_entries WHERE project_id = ? ORDER BY occurred_on DESC, created_at DESC",
    ).bind(projectId).all<Record<string, unknown>>(),
    env.DB.prepare(
      "SELECT a.id, a.entry_id, a.filename, a.content_type, a.size, a.created_at FROM attachments a JOIN ledger_entries e ON e.id = a.entry_id WHERE e.project_id = ?",
    ).bind(projectId).all<Record<string, unknown>>(),
    env.DB.prepare(
      "SELECT * FROM people WHERE project_id = ? ORDER BY active DESC, name",
    ).bind(projectId).all<Record<string, unknown>>(),
    env.DB.prepare(
      "SELECT * FROM fund_transfers WHERE project_id = ? ORDER BY occurred_on DESC, created_at DESC",
    ).bind(projectId).all<Record<string, unknown>>(),
  ]);
  if (!project) return json({ error: "找不到此工程案" }, { status: 404 });
  return json({
    project: mapProject(project),
    categories: categoryResult.results.map((category) => mapCategory(category, itemResult.results)),
    entries: entryResult.results.map((entry) => mapEntry(entry, attachmentResult.results)),
    people: peopleResult.results.map(mapPerson),
    transfers: transferResult.results.map(mapTransfer),
  });
}

async function categories(request: Request, env: Env, projectId: string, categoryId?: string): Promise<Response> {
  if (!await findProject(projectId, env)) return json({ error: "找不到此工程案" }, { status: 404 });
  if (!categoryId && request.method === "GET") {
    const [result, itemResult] = await Promise.all([
      env.DB.prepare(
        "SELECT id, name, planned_amount, color, sort_order FROM budget_categories WHERE project_id = ? ORDER BY sort_order, name",
      ).bind(projectId).all<Record<string, unknown>>(),
      env.DB.prepare(
        "SELECT id, category_id, name, planned_amount, sort_order FROM budget_line_items WHERE project_id = ? ORDER BY category_id, sort_order, name",
      ).bind(projectId).all<Record<string, unknown>>(),
    ]);
    return json(result.results.map((category) => mapCategory(category, itemResult.results)));
  }
  if (!categoryId && request.method === "POST") {
    const body = await requireJson(request);
    const name = text(body.name, 30);
    const manualPlannedAmount =
      typeof body.plannedAmount === "number" && Number.isSafeInteger(body.plannedAmount) && body.plannedAmount >= 0
        ? body.plannedAmount
        : null;
    const items = body.items === undefined ? undefined : parseBudgetItems(body.items);
    const plannedAmount = items?.reduce((sum, item) => sum + item.plannedAmount, 0) ?? manualPlannedAmount;
    const color = /^#[0-9a-fA-F]{6}$/.test(String(body.color)) ? String(body.color) : "#1d6f63";
    if (!name || plannedAmount === null || items === null) return json({ error: "分類名稱、預算或細項不正確" }, { status: 400 });
    const max = await env.DB.prepare(
      "SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM budget_categories WHERE project_id = ?",
    ).bind(projectId).first<{ max_order: number }>();
    const id = newId();
    const timestamp = now();
    await env.DB.prepare(
      "INSERT INTO budget_categories (id, project_id, name, planned_amount, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, projectId, name, plannedAmount, color, (max?.max_order ?? 0) + 1, timestamp, timestamp).run();
    if (items) await replaceBudgetItems(env, projectId, id, items, timestamp);
    await touchProject(projectId, env);
    return json((await categoryWithItems(env, projectId, id))!, { status: 201 });
  }
  if (!categoryId) return json({ error: "找不到分類操作" }, { status: 404 });
  const existing = await env.DB.prepare(
    "SELECT id FROM budget_categories WHERE id = ? AND project_id = ?",
  ).bind(categoryId, projectId).first();
  if (!existing) return json({ error: "找不到此分類" }, { status: 404 });
  if (request.method === "PATCH") {
    const body = await requireJson(request);
    const name = text(body.name, 30);
    const manualPlannedAmount =
      typeof body.plannedAmount === "number" && Number.isSafeInteger(body.plannedAmount) && body.plannedAmount >= 0
        ? body.plannedAmount
        : null;
    const items = body.items === undefined ? undefined : parseBudgetItems(body.items);
    const plannedAmount = items?.reduce((sum, item) => sum + item.plannedAmount, 0) ?? manualPlannedAmount;
    const color = /^#[0-9a-fA-F]{6}$/.test(String(body.color)) ? String(body.color) : "#1d6f63";
    if (!name || plannedAmount === null || items === null) return json({ error: "分類名稱、預算或細項不正確" }, { status: 400 });
    const timestamp = now();
    await env.DB.prepare(
      "UPDATE budget_categories SET name = ?, planned_amount = ?, color = ?, updated_at = ? WHERE id = ? AND project_id = ?",
    ).bind(name, plannedAmount, color, timestamp, categoryId, projectId).run();
    if (items) await replaceBudgetItems(env, projectId, categoryId, items, timestamp);
    await touchProject(projectId, env);
    return json((await categoryWithItems(env, projectId, categoryId))!);
  }
  if (request.method === "DELETE") {
    const usage = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM ledger_entries WHERE category_id = ? AND project_id = ?",
    ).bind(categoryId, projectId).first<{ count: number }>();
    if ((usage?.count ?? 0) > 0) {
      return json({ error: "此分類已有帳務紀錄，請先重新分類相關紀錄。" }, { status: 409 });
    }
    await env.DB.prepare("DELETE FROM budget_categories WHERE id = ? AND project_id = ?")
      .bind(categoryId, projectId).run();
    await touchProject(projectId, env);
    return new Response(null, { status: 204 });
  }
  return json({ error: "不支援的方法" }, { status: 405 });
}

async function people(request: Request, env: Env, projectId: string, personId?: string): Promise<Response> {
  if (!await findProject(projectId, env)) return json({ error: "找不到此工程案" }, { status: 404 });
  if (!personId && request.method === "GET") {
    const result = await env.DB.prepare(
      "SELECT * FROM people WHERE project_id = ? ORDER BY active DESC, name",
    ).bind(projectId).all<Record<string, unknown>>();
    return json(result.results.map(mapPerson));
  }
  if (!personId && request.method === "POST") {
    const input = parsePerson(await requireJson(request));
    const duplicate = await env.DB.prepare(
      "SELECT id FROM people WHERE project_id = ? AND name = ? COLLATE NOCASE",
    ).bind(projectId, input.name).first();
    if (duplicate) return json({ error: "已有相同名稱的人員" }, { status: 409 });
    const id = newId();
    const timestamp = now();
    await env.DB.prepare(
      "INSERT INTO people (id, project_id, name, role, note, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, projectId, input.name, input.role, input.note, input.active ? 1 : 0, timestamp, timestamp).run();
    await touchProject(projectId, env);
    const result = await env.DB.prepare("SELECT * FROM people WHERE id = ?").bind(id).first<Record<string, unknown>>();
    return json(mapPerson(result!), { status: 201 });
  }
  if (!personId) return json({ error: "找不到人員操作" }, { status: 404 });
  const existing = await env.DB.prepare(
    "SELECT * FROM people WHERE id = ? AND project_id = ?",
  ).bind(personId, projectId).first<Record<string, unknown>>();
  if (!existing) return json({ error: "找不到此人員" }, { status: 404 });
  if (request.method === "PATCH") {
    const input = parsePerson(await requireJson(request));
    const duplicate = await env.DB.prepare(
      "SELECT id FROM people WHERE project_id = ? AND name = ? COLLATE NOCASE AND id != ?",
    ).bind(projectId, input.name, personId).first();
    if (duplicate) return json({ error: "已有相同名稱的人員" }, { status: 409 });
    const timestamp = now();
    await env.DB.prepare(
      "UPDATE people SET name = ?, role = ?, note = ?, active = ?, updated_at = ? WHERE id = ? AND project_id = ?",
    ).bind(input.name, input.role, input.note, input.active ? 1 : 0, timestamp, personId, projectId).run();
    await touchProject(projectId, env);
    const updated = await env.DB.prepare("SELECT * FROM people WHERE id = ?").bind(personId).first<Record<string, unknown>>();
    return json(mapPerson(updated!));
  }
  if (request.method === "DELETE") {
    const usage = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM ledger_entries WHERE project_id = ? AND person_id = ?) + (SELECT COUNT(*) FROM fund_transfers WHERE project_id = ? AND (from_person_id = ? OR to_person_id = ?)) AS count",
    ).bind(projectId, personId, projectId, personId, personId).first<{ count: number }>();
    if ((usage?.count ?? 0) > 0) return json({ error: "已有往來紀錄的人員不可刪除，請改為停用" }, { status: 409 });
    await env.DB.prepare("DELETE FROM people WHERE id = ? AND project_id = ?").bind(personId, projectId).run();
    await touchProject(projectId, env);
    return new Response(null, { status: 204 });
  }
  return json({ error: "不支援的方法" }, { status: 405 });
}

async function transfers(request: Request, env: Env, projectId: string, transferId?: string): Promise<Response> {
  if (!await findProject(projectId, env)) return json({ error: "找不到此工程案" }, { status: 404 });
  if (!transferId && request.method === "GET") {
    const result = await env.DB.prepare(
      "SELECT * FROM fund_transfers WHERE project_id = ? ORDER BY occurred_on DESC, created_at DESC",
    ).bind(projectId).all<Record<string, unknown>>();
    return json(result.results.map(mapTransfer));
  }
  if (!transferId && request.method === "POST") {
    const input = await resolveTransferPeople(env, projectId, parseTransfer(await requireJson(request)));
    const id = newId();
    const timestamp = now();
    await env.DB.prepare(
      "INSERT INTO fund_transfers (id, project_id, from_person_id, to_person_id, amount, occurred_on, status, payment_method, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, projectId, input.fromPersonId, input.toPersonId, input.amount, input.occurredOn, input.status, input.paymentMethod, input.note, timestamp, timestamp).run();
    await touchProject(projectId, env);
    const result = await env.DB.prepare("SELECT * FROM fund_transfers WHERE id = ?").bind(id).first<Record<string, unknown>>();
    return json(mapTransfer(result!), { status: 201 });
  }
  if (!transferId) return json({ error: "找不到資金移轉操作" }, { status: 404 });
  const existing = await env.DB.prepare(
    "SELECT id FROM fund_transfers WHERE id = ? AND project_id = ?",
  ).bind(transferId, projectId).first();
  if (!existing) return json({ error: "找不到此筆資金移轉" }, { status: 404 });
  if (request.method === "PATCH") {
    const input = await resolveTransferPeople(env, projectId, parseTransfer(await requireJson(request)));
    const timestamp = now();
    await env.DB.prepare(
      "UPDATE fund_transfers SET from_person_id = ?, to_person_id = ?, amount = ?, occurred_on = ?, status = ?, payment_method = ?, note = ?, updated_at = ? WHERE id = ? AND project_id = ?",
    ).bind(input.fromPersonId, input.toPersonId, input.amount, input.occurredOn, input.status, input.paymentMethod, input.note, timestamp, transferId, projectId).run();
    await touchProject(projectId, env);
    const updated = await env.DB.prepare("SELECT * FROM fund_transfers WHERE id = ?").bind(transferId).first<Record<string, unknown>>();
    return json(mapTransfer(updated!));
  }
  if (request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM fund_transfers WHERE id = ? AND project_id = ?").bind(transferId, projectId).run();
    await touchProject(projectId, env);
    return new Response(null, { status: 204 });
  }
  return json({ error: "不支援的方法" }, { status: 405 });
}


async function entries(request: Request, env: Env, projectId: string, entryId?: string): Promise<Response> {
  if (!await findProject(projectId, env)) return json({ error: "找不到此工程案" }, { status: 404 });
  if (!entryId && request.method === "GET") {
    const [entryResult, attachmentResult] = await Promise.all([
      env.DB.prepare(
        "SELECT * FROM ledger_entries WHERE project_id = ? ORDER BY occurred_on DESC, created_at DESC",
      ).bind(projectId).all<Record<string, unknown>>(),
      env.DB.prepare(
        "SELECT a.id, a.entry_id, a.filename, a.content_type, a.size, a.created_at FROM attachments a JOIN ledger_entries e ON e.id = a.entry_id WHERE e.project_id = ?",
      ).bind(projectId).all<Record<string, unknown>>(),
    ]);
    return json(entryResult.results.map((entry) => mapEntry(entry, attachmentResult.results)));
  }
  if (!entryId && request.method === "POST") {
    let input = parseEntry(await requireJson(request));
    input = await validateRefundSource(env, projectId, input);
    input = await resolveEntryPerson(env, projectId, input);
    if (input.categoryId) {
      const exists = await env.DB.prepare(
        "SELECT id FROM budget_categories WHERE id = ? AND project_id = ?",
      ).bind(input.categoryId, projectId).first();
      if (!exists) return json({ error: "找不到指定的預算分類" }, { status: 400 });
    }
    const id = newId();
    const timestamp = now();
    await env.DB.prepare(`
      INSERT INTO ledger_entries
        (id, project_id, kind, status, refund_of_entry_id, description, amount, occurred_on, category_id, person_id, counterparty, payment_method, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, projectId, input.kind, input.status, input.refundOfEntryId, input.description, input.amount, input.occurredOn,
      input.categoryId, input.personId, input.counterparty, input.paymentMethod, input.note, timestamp, timestamp,
    ).run();
    await touchProject(projectId, env);
    return json({ id, ...input, attachments: [], createdAt: timestamp, updatedAt: timestamp }, { status: 201 });
  }
  if (!entryId) return json({ error: "找不到帳務操作" }, { status: 404 });
  const existing = await env.DB.prepare(
    "SELECT id, kind FROM ledger_entries WHERE id = ? AND project_id = ?",
  ).bind(entryId, projectId).first<{ id: string; kind: EntryKind }>();
  if (!existing) return json({ error: "找不到此紀錄" }, { status: 404 });
  if (request.method === "PATCH") {
    let input = parseEntry(await requireJson(request));
    input = await validateRefundSource(env, projectId, input, entryId);
    input = await resolveEntryPerson(env, projectId, input);
    if (existing.kind === "expense") await validateExpenseChange(env, projectId, entryId, input);
    if (input.categoryId) {
      const category = await env.DB.prepare(
        "SELECT id FROM budget_categories WHERE id = ? AND project_id = ?",
      ).bind(input.categoryId, projectId).first();
      if (!category) return json({ error: "找不到指定的預算分類" }, { status: 400 });
    }
    const timestamp = now();
    await env.DB.prepare(`
      UPDATE ledger_entries SET
        kind = ?, status = ?, refund_of_entry_id = ?, description = ?, amount = ?, occurred_on = ?, category_id = ?,
        person_id = ?, counterparty = ?, payment_method = ?, note = ?, updated_at = ?
      WHERE id = ? AND project_id = ?
    `).bind(
      input.kind, input.status, input.refundOfEntryId, input.description, input.amount, input.occurredOn, input.categoryId,
      input.personId, input.counterparty, input.paymentMethod, input.note, timestamp, entryId, projectId,
    ).run();
    if (input.kind === "expense") {
      await env.DB.prepare(
        "UPDATE ledger_entries SET person_id = ?, counterparty = ?, updated_at = ? WHERE project_id = ? AND refund_of_entry_id = ?",
      ).bind(input.personId, input.counterparty, timestamp, projectId, entryId).run();
    }
    await touchProject(projectId, env);
    const attachments = await env.DB.prepare(
      "SELECT id, entry_id, filename, content_type, size, created_at FROM attachments WHERE entry_id = ?",
    ).bind(entryId).all<Record<string, unknown>>();
    return json({ id: entryId, ...input, attachments: attachments.results.map(mapAttachment), updatedAt: timestamp });
  }
  if (request.method === "DELETE") {
    const linkedRefunds = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM ledger_entries WHERE project_id = ? AND refund_of_entry_id = ?",
    ).bind(projectId, entryId).first<{ count: number }>();
    if ((linkedRefunds?.count ?? 0) > 0) {
      return json({ error: "此支出已有退款紀錄，請先刪除相關退款。" }, { status: 409 });
    }
    const attachments = await env.DB.prepare(
      "SELECT object_key FROM attachments WHERE entry_id = ?",
    ).bind(entryId).all<{ object_key: string }>();
    if (attachments.results.length) await env.RECEIPTS.delete(attachments.results.map((item) => item.object_key));
    await env.DB.batch([
      env.DB.prepare("DELETE FROM attachments WHERE entry_id = ?").bind(entryId),
      env.DB.prepare("DELETE FROM ledger_entries WHERE id = ? AND project_id = ?").bind(entryId, projectId),
    ]);
    await touchProject(projectId, env);
    return new Response(null, { status: 204 });
  }
  return json({ error: "不支援的方法" }, { status: 405 });
}

async function attachmentRoutes(
  request: Request,
  env: Env,
  projectId: string,
  entryId?: string,
  attachmentId?: string,
): Promise<Response> {
  if (entryId && request.method === "POST") {
    const entry = await env.DB.prepare(
      "SELECT id FROM ledger_entries WHERE id = ? AND project_id = ?",
    ).bind(entryId, projectId).first();
    if (!entry) return json({ error: "找不到此帳務紀錄" }, { status: 404 });
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM attachments WHERE entry_id = ?",
    ).bind(entryId).first<{ count: number }>();
    if ((count?.count ?? 0) >= 5) return json({ error: "每筆支出最多 5 張憑證" }, { status: 400 });
    const form = await request.formData();
    const file = form.get("file");
    if (
      !(file instanceof File) ||
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      return json({ error: "附件限 JPG、PNG、WebP，且每張不得超過 10MB" }, { status: 400 });
    }
    const id = newId();
    const objectKey = `projects/${projectId}/entries/${entryId}/${id}`;
    await env.RECEIPTS.put(objectKey, file.stream(), { httpMetadata: { contentType: file.type } });
    const timestamp = now();
    await env.DB.prepare(`
      INSERT INTO attachments (id, entry_id, object_key, filename, content_type, size, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(id, entryId, objectKey, text(file.name, 160) || "receipt", file.type, file.size, timestamp).run();
    await touchProject(projectId, env);
    return json({
      id,
      entryId,
      filename: text(file.name, 160) || "receipt",
      contentType: file.type,
      size: file.size,
      createdAt: timestamp,
    }, { status: 201 });
  }
  if (!attachmentId) return json({ error: "找不到附件" }, { status: 404 });
  const attachment = await env.DB.prepare(`
    SELECT a.* FROM attachments a
    JOIN ledger_entries e ON e.id = a.entry_id
    WHERE a.id = ? AND e.project_id = ?
  `).bind(attachmentId, projectId).first<Record<string, unknown>>();
  if (!attachment) return json({ error: "找不到附件" }, { status: 404 });
  if (request.method === "GET") {
    const object = await env.RECEIPTS.get(String(attachment.object_key));
    if (!object) return json({ error: "附件檔案不存在" }, { status: 404 });
    return new Response(object.body, {
      headers: {
        "Content-Type": String(attachment.content_type),
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(String(attachment.filename))}`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  }
  if (request.method === "DELETE") {
    await env.RECEIPTS.delete(String(attachment.object_key));
    await env.DB.prepare("DELETE FROM attachments WHERE id = ?").bind(attachmentId).run();
    await touchProject(projectId, env);
    return new Response(null, { status: 204 });
  }
  return json({ error: "不支援的方法" }, { status: 405 });
}

async function exportCsv(env: Env, projectId: string): Promise<Response> {
  if (!await findProject(projectId, env)) return json({ error: "找不到此工程案" }, { status: 404 });
  const result = await env.DB.prepare(`
    SELECT e.occurred_on, e.kind, e.description, COALESCE(c.name, '') AS category_name,
      e.amount, e.status, e.counterparty, e.payment_method, e.note,
      COALESCE(source.description, '') AS source_description
    FROM ledger_entries e
    LEFT JOIN budget_categories c ON c.id = e.category_id
    LEFT JOIN ledger_entries source ON source.id = e.refund_of_entry_id
    WHERE e.project_id = ?
    ORDER BY e.occurred_on DESC
  `).bind(projectId).all<Record<string, unknown>>();
  const headers = ["日期", "類型", "品項", "分類", "金額", "狀態", "對象", "付款方式", "原始支出", "備註"];
  const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = "\uFEFF" + [
    headers,
    ...result.results.map((row) => [
      row.occurred_on, row.kind, row.description, row.category_name, row.amount,
      row.status, row.counterparty, row.payment_method, row.source_description, row.note,
    ]),
  ].map((row) => row.map(quote).join(",")).join("\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename*=UTF-8''rainbow-project-budget.csv",
    },
  });
}

async function exportCashflowCsv(env: Env, projectId: string): Promise<Response> {
  if (!await findProject(projectId, env)) return json({ error: "找不到此工程案" }, { status: 404 });
  const result = await env.DB.prepare(`
    SELECT e.occurred_on, e.kind AS source_type,
      CASE WHEN e.kind = 'expense' THEN '工程帳戶' ELSE COALESCE(p.name, '未指定人員') END AS from_name,
      CASE WHEN e.kind = 'expense' THEN COALESCE(p.name, '未指定人員') ELSE '工程帳戶' END AS to_name,
      CASE WHEN e.kind = 'expense' THEN '' ELSE COALESCE(p.role, '') END AS from_role,
      CASE WHEN e.kind = 'expense' THEN COALESCE(p.role, '') ELSE '' END AS to_role,
      e.status, e.amount, e.payment_method, e.note
    FROM ledger_entries e
    LEFT JOIN people p ON p.id = e.person_id
    WHERE e.project_id = ? AND e.person_id IS NOT NULL
    UNION ALL
    SELECT t.occurred_on, 'transfer' AS source_type,
      sender.name AS from_name, receiver.name AS to_name,
      sender.role AS from_role, receiver.role AS to_role,
      t.status, t.amount, t.payment_method, t.note
    FROM fund_transfers t
    JOIN people sender ON sender.id = t.from_person_id
    JOIN people receiver ON receiver.id = t.to_person_id
    WHERE t.project_id = ?
    ORDER BY occurred_on DESC
  `).bind(projectId, projectId).all<Record<string, unknown>>();
  const headers = ["日期", "類型", "出款方", "出款方身分", "收款方", "收款方身分", "狀態", "金額", "付款方式", "備註"];
  const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = "\uFEFF" + [headers, ...result.results.map((row) => [
    row.occurred_on, row.source_type, row.from_name, row.from_role, row.to_name, row.to_role,
    row.status, row.amount, row.payment_method, row.note,
  ])].map((row) => row.map(quote).join(",")).join("\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename*=UTF-8''rainbow-project-cashflow.csv",
    },
  });
}


async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (!isAllowedOrigin(request, env)) return json({ error: "不允許此來源存取" }, { status: 403 });
  if (url.pathname === "/api/health") {
    const removedLegacyAttachments = await cleanupLegacyAttachments(env);
    return json({ ok: true, removedLegacyAttachments });
  }
  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    if (!await rateLimit(request, env)) {
      return json({ error: "登入嘗試次數過多，請 15 分鐘後再試。" }, { status: 429 });
    }
    const body = await requireJson(request);
    const code = text(body.code, 64);
    if (!safeEqual(code, env.BUDGET_ACCESS_CODE)) {
      await recordFailure(request, env);
      return json({ error: "密碼不正確" }, { status: 401 });
    }
    await clearFailures(request, env);
    return json({ token: await issueToken(env) });
  }
  if (!await hasSession(request, env)) return json({ error: "請先輸入存取碼" }, { status: 401 });
  if (url.pathname === "/api/auth/logout" && request.method === "POST") return new Response(null, { status: 204 });
  if (url.pathname === "/api/projects") return projectCollection(request, env);

  const projectItemMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (projectItemMatch) return projectItem(request, env, projectItemMatch[1]);
  const statusMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/(archive|restore)$/);
  if (statusMatch && request.method === "POST") {
    return setProjectStatus(env, statusMatch[1], statusMatch[2] === "archive" ? "archived" : "active");
  }
  const dashboardMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/dashboard$/);
  if (dashboardMatch && request.method === "GET") return dashboard(env, dashboardMatch[1]);
  const peopleMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/people(?:\/([^/]+))?$/);
  if (peopleMatch) return people(request, env, peopleMatch[1], peopleMatch[2]);
  const transferMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/transfers(?:\/([^/]+))?$/);
  if (transferMatch) return transfers(request, env, transferMatch[1], transferMatch[2]);
  const categoryMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/categories(?:\/([^/]+))?$/);
  if (categoryMatch) return categories(request, env, categoryMatch[1], categoryMatch[2]);
  const uploadMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/entries\/([^/]+)\/attachments$/);
  if (uploadMatch) return attachmentRoutes(request, env, uploadMatch[1], uploadMatch[2]);
  const cashflowExportMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/cashflow\/export\.csv$/);
  if (cashflowExportMatch && request.method === "GET") return exportCashflowCsv(env, cashflowExportMatch[1]);
  const entryMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/entries(?:\/([^/]+))?$/);
  if (entryMatch) return entries(request, env, entryMatch[1], entryMatch[2]);
  const attachmentMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/attachments\/([^/]+)$/);
  if (attachmentMatch) return attachmentRoutes(request, env, attachmentMatch[1], undefined, attachmentMatch[2]);
  const exportMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/export\.csv$/);
  if (exportMatch && request.method === "GET") return exportCsv(env, exportMatch[1]);
  return json({ error: "找不到 API" }, { status: 404 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return withCors(await handle(request, env), request, env);
    } catch (error) {
      console.error(error);
      return withCors(
        json({ error: error instanceof Error ? error.message : "伺服器發生錯誤" }, { status: 500 }),
        request,
        env,
      );
    }
  },
} satisfies ExportedHandler<Env>;
