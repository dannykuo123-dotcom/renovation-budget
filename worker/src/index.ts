export interface Env {
  DB: D1Database;
  RECEIPTS: R2Bucket;
  ALLOWED_ORIGIN: string;
  BUDGET_ACCESS_CODE: string;
  SESSION_SIGNING_SECRET: string;
}

type EntryKind = "income" | "expense";
type EntryStatus = "posted" | "pending" | "void";
type TransferStatus = "posted" | "pending" | "void";
type ProjectStatus = "active" | "completed" | "archived";
type EntryInput = {
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
  spaceId: string;
  categoryId: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
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

const MAX_BUDGET_ITEM_SUBTOTAL = 1_000_000_000_000;
const MAX_OWNER_BUDGET = 1_000_000_000_000;

function parseOwnerBudget(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_OWNER_BUDGET
    ? value
    : null;
}

function parseBudgetItem(input: Record<string, unknown>): BudgetItemInput | null {
  const spaceId = text(input.spaceId, 80);
  const categoryId = typeof input.categoryId === "string" && input.categoryId ? text(input.categoryId, 80) : null;
  const name = text(input.name, 60);
  const quantity = input.quantity;
  const unitPrice = input.unitPrice;
  if (!spaceId || !name || typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity <= 0 ||
    typeof unitPrice !== "number" || !Number.isSafeInteger(unitPrice) || unitPrice < 0) return null;
  const plannedAmount = quantity * unitPrice;
  if (!Number.isSafeInteger(plannedAmount) || plannedAmount > MAX_BUDGET_ITEM_SUBTOTAL) return null;
  return { spaceId, categoryId, name, quantity, unitPrice, plannedAmount };
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
    !["income", "expense"].includes(String(kind)) ||
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
  return {
    kind: kind as EntryKind,
    status: status as EntryStatus,
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
  if (!name) throw new Error("請輸入人員名稱");
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
  if (!amount || !/^\d{4}-\d{2}-\d{2}$/.test(occurredOn) || !["posted", "pending", "void"].includes(status)) {
    throw new Error("資金移轉資料不完整或格式錯誤");
  }
  if (!fromPersonId || !toPersonId || fromPersonId === toPersonId) {
    throw new Error("轉出人與轉入人必須是不同人員");
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
  ownerBudget: Number(row.owner_budget ?? 0),
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
  spaceId: row.space_id,
  categoryId: row.category_id,
  name: row.name,
  quantity: Number(row.quantity),
  unitPrice: Number(row.unit_price),
  plannedAmount: Number(row.planned_amount),
  sortOrder: Number(row.sort_order),
});

const mapCategory = (row: Record<string, unknown>) => ({
  id: row.id,
  name: row.name,
  color: row.color,
  sortOrder: Number(row.sort_order),
});

const mapBudgetSpace = (row: Record<string, unknown>, items: Record<string, unknown>[]) => ({
  id: row.id,
  name: row.name,
  sortOrder: Number(row.sort_order),
  items: items.filter((item) => item.space_id === row.id).map(mapBudgetItem),
});

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
  if (!input.personId) throw new Error("請選擇人員");
  const person = await env.DB.prepare(
    "SELECT id, name FROM people WHERE id = ? AND project_id = ? AND active = 1",
  ).bind(input.personId, projectId).first<{ id: string; name: string }>();
  if (!person) throw new Error("請選擇啟用中的人員");
  return { ...input, personId: person.id, counterparty: person.name };
}

async function resolveTransferPeople(
  env: Env,
  projectId: string,
  input: TransferInput,
): Promise<TransferInput> {
  const result = await env.DB.prepare(
    "SELECT id FROM people WHERE project_id = ? AND active = 1 AND id IN (?, ?)",
  ).bind(projectId, input.fromPersonId, input.toPersonId).all<{ id: string }>();
  if (result.results.length !== 2) throw new Error("轉出人與轉入人都必須是啟用中的人員");
  return input;
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
        COALESCE((SELECT SUM(item.planned_amount) FROM budget_line_items item WHERE item.project_id = p.id), 0) AS planned,
        COALESCE((SELECT SUM(e.amount) FROM ledger_entries e WHERE e.project_id = p.id AND e.kind = 'income' AND e.status = 'posted'), 0) AS received,
        COALESCE((SELECT SUM(CASE WHEN e.kind = 'expense' THEN e.amount ELSE 0 END)
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
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO projects (id, name, address, status, currency, created_at, updated_at) VALUES (?, ?, ?, ?, 'TWD', ?, ?)",
      ).bind(projectId, input.name, input.address, input.status, timestamp, timestamp),
      env.DB.prepare(
        "INSERT INTO budget_spaces (id, project_id, name, sort_order, created_at, updated_at) VALUES (?, ?, '未分空間', 1, ?, ?)",
      ).bind(newId(), projectId, timestamp, timestamp),
    ]);
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

async function ownerBudget(request: Request, env: Env, projectId: string): Promise<Response> {
  if (request.method !== "PATCH") return json({ error: "不支援的方法" }, { status: 405 });
  if (!await findProject(projectId, env)) return json({ error: "找不到此工程案" }, { status: 404 });
  const input = await requireJson(request);
  const amount = parseOwnerBudget(input.ownerBudget);
  if (amount === null) return json({ error: "屋主預算格式不正確" }, { status: 400 });
  await env.DB.prepare("UPDATE projects SET owner_budget = ?, updated_at = ? WHERE id = ?")
    .bind(amount, now(), projectId).run();
  return json(mapProject((await findProject(projectId, env))!));
}

async function setProjectStatus(env: Env, projectId: string, status: ProjectStatus): Promise<Response> {
  const result = await env.DB.prepare("UPDATE projects SET status = ?, updated_at = ? WHERE id = ?")
    .bind(status, now(), projectId).run();
  if (!result.meta.changes) return json({ error: "找不到此工程案" }, { status: 404 });
  return json(mapProject((await findProject(projectId, env))!));
}

async function dashboard(env: Env, projectId: string): Promise<Response> {
  const [project, categoryResult, spaceResult, itemResult, entryResult, attachmentResult, peopleResult, transferResult] = await Promise.all([
    findProject(projectId, env),
    env.DB.prepare(
      "SELECT id, name, color, sort_order FROM budget_categories WHERE project_id = ? ORDER BY sort_order, name",
    ).bind(projectId).all<Record<string, unknown>>(),
    env.DB.prepare(
      "SELECT id, name, sort_order FROM budget_spaces WHERE project_id = ? ORDER BY sort_order, name",
    ).bind(projectId).all<Record<string, unknown>>(),
    env.DB.prepare(
      "SELECT id, space_id, category_id, name, quantity, unit_price, planned_amount, sort_order FROM budget_line_items WHERE project_id = ? ORDER BY space_id, sort_order, name",
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
    categories: categoryResult.results.map(mapCategory),
    spaces: spaceResult.results.map((space) => mapBudgetSpace(space, itemResult.results)),
    entries: entryResult.results.map((entry) => mapEntry(entry, attachmentResult.results)),
    people: peopleResult.results.map(mapPerson),
    transfers: transferResult.results.map(mapTransfer),
  });
}
async function categories(request: Request, env: Env, projectId: string, categoryId?: string): Promise<Response> {
  if (!await findProject(projectId, env)) return json({ error: "找不到此工程案" }, { status: 404 });
  if (!categoryId && request.method === "GET") {
    const result = await env.DB.prepare(
      "SELECT id, name, color, sort_order FROM budget_categories WHERE project_id = ? ORDER BY sort_order, name",
    ).bind(projectId).all<Record<string, unknown>>();
    return json(result.results.map(mapCategory));
  }
  if (!categoryId && request.method === "POST") {
    const body = await requireJson(request);
    const name = text(body.name, 30);
    const color = /^#[0-9a-fA-F]{6}$/.test(String(body.color)) ? String(body.color) : "#1d6f63";
    if (!name) return json({ error: "請輸入分類名稱" }, { status: 400 });
    const duplicate = await env.DB.prepare(
      "SELECT id FROM budget_categories WHERE project_id = ? AND name = ? COLLATE NOCASE",
    ).bind(projectId, name).first();
    if (duplicate) return json({ error: "已有相同名稱的分類" }, { status: 409 });
    const max = await env.DB.prepare(
      "SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM budget_categories WHERE project_id = ?",
    ).bind(projectId).first<{ max_order: number }>();
    const id = newId();
    const timestamp = now();
    await env.DB.prepare(
      "INSERT INTO budget_categories (id, project_id, name, planned_amount, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?, ?)",
    ).bind(id, projectId, name, color, (max?.max_order ?? 0) + 1, timestamp, timestamp).run();
    await touchProject(projectId, env);
    const category = await env.DB.prepare(
      "SELECT id, name, color, sort_order FROM budget_categories WHERE id = ? AND project_id = ?",
    ).bind(id, projectId).first<Record<string, unknown>>();
    return json(mapCategory(category!), { status: 201 });
  }
  if (!categoryId) return json({ error: "找不到分類操作" }, { status: 404 });
  const existing = await env.DB.prepare(
    "SELECT id FROM budget_categories WHERE id = ? AND project_id = ?",
  ).bind(categoryId, projectId).first();
  if (!existing) return json({ error: "找不到此分類" }, { status: 404 });
  if (request.method === "PATCH") {
    const body = await requireJson(request);
    const name = text(body.name, 30);
    const color = /^#[0-9a-fA-F]{6}$/.test(String(body.color)) ? String(body.color) : "#1d6f63";
    if (!name) return json({ error: "請輸入分類名稱" }, { status: 400 });
    const duplicate = await env.DB.prepare(
      "SELECT id FROM budget_categories WHERE project_id = ? AND name = ? COLLATE NOCASE AND id <> ?",
    ).bind(projectId, name, categoryId).first();
    if (duplicate) return json({ error: "已有相同名稱的分類" }, { status: 409 });
    await env.DB.prepare(
      "UPDATE budget_categories SET name = ?, color = ?, updated_at = ? WHERE id = ? AND project_id = ?",
    ).bind(name, color, now(), categoryId, projectId).run();
    await touchProject(projectId, env);
    const category = await env.DB.prepare(
      "SELECT id, name, color, sort_order FROM budget_categories WHERE id = ? AND project_id = ?",
    ).bind(categoryId, projectId).first<Record<string, unknown>>();
    return json(mapCategory(category!));
  }
  if (request.method === "DELETE") {
    const usage = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM ledger_entries WHERE category_id = ? AND project_id = ?) + (SELECT COUNT(*) FROM budget_line_items WHERE category_id = ? AND project_id = ?) AS count",
    ).bind(categoryId, projectId, categoryId, projectId).first<{ count: number }>();
    if ((usage?.count ?? 0) > 0) return json({ error: "此分類已有帳務或預算項目，請先重新分類相關紀錄。" }, { status: 409 });
    await env.DB.prepare("DELETE FROM budget_categories WHERE id = ? AND project_id = ?").bind(categoryId, projectId).run();
    await touchProject(projectId, env);
    return new Response(null, { status: 204 });
  }
  return json({ error: "不支援的方法" }, { status: 405 });
}

async function budgetSpaces(request: Request, env: Env, projectId: string, spaceId?: string): Promise<Response> {
  if (!await findProject(projectId, env)) return json({ error: "找不到此工程案" }, { status: 404 });
  if (!spaceId && request.method === "GET") {
    const [spaces, items] = await Promise.all([
      env.DB.prepare("SELECT id, name, sort_order FROM budget_spaces WHERE project_id = ? ORDER BY sort_order, name").bind(projectId).all<Record<string, unknown>>(),
      env.DB.prepare("SELECT id, space_id, category_id, name, quantity, unit_price, planned_amount, sort_order FROM budget_line_items WHERE project_id = ? ORDER BY space_id, sort_order, name").bind(projectId).all<Record<string, unknown>>(),
    ]);
    return json(spaces.results.map((space) => mapBudgetSpace(space, items.results)));
  }
  if (!spaceId && request.method === "POST") {
    const body = await requireJson(request);
    const name = text(body.name, 30);
    if (!name) return json({ error: "請輸入空間名稱" }, { status: 400 });
    const duplicate = await env.DB.prepare("SELECT id FROM budget_spaces WHERE project_id = ? AND name = ? COLLATE NOCASE").bind(projectId, name).first();
    if (duplicate) return json({ error: "已有相同名稱的空間" }, { status: 409 });
    const max = await env.DB.prepare("SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM budget_spaces WHERE project_id = ?").bind(projectId).first<{ max_order: number }>();
    const id = newId();
    const timestamp = now();
    await env.DB.prepare("INSERT INTO budget_spaces (id, project_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, projectId, name, (max?.max_order ?? 0) + 1, timestamp, timestamp).run();
    await touchProject(projectId, env);
    return json(mapBudgetSpace({ id, name, sort_order: (max?.max_order ?? 0) + 1 }, []), { status: 201 });
  }
  if (!spaceId) return json({ error: "找不到空間操作" }, { status: 404 });
  const existing = await env.DB.prepare("SELECT id, name, sort_order FROM budget_spaces WHERE id = ? AND project_id = ?").bind(spaceId, projectId).first<Record<string, unknown>>();
  if (!existing) return json({ error: "找不到此空間" }, { status: 404 });
  if (request.method === "PATCH") {
    const body = await requireJson(request);
    const name = text(body.name, 30);
    if (!name) return json({ error: "請輸入空間名稱" }, { status: 400 });
    const duplicate = await env.DB.prepare("SELECT id FROM budget_spaces WHERE project_id = ? AND name = ? COLLATE NOCASE AND id <> ?").bind(projectId, name, spaceId).first();
    if (duplicate) return json({ error: "已有相同名稱的空間" }, { status: 409 });
    await env.DB.prepare("UPDATE budget_spaces SET name = ?, updated_at = ? WHERE id = ? AND project_id = ?").bind(name, now(), spaceId, projectId).run();
    await touchProject(projectId, env);
    const items = await env.DB.prepare(
      "SELECT id, space_id, category_id, name, quantity, unit_price, planned_amount, sort_order FROM budget_line_items WHERE project_id = ? AND space_id = ? ORDER BY sort_order, name",
    ).bind(projectId, spaceId).all<Record<string, unknown>>();
    return json(mapBudgetSpace({ ...existing, name }, items.results));
  }
  if (request.method === "DELETE") {
    const usage = await env.DB.prepare("SELECT COUNT(*) AS count FROM budget_line_items WHERE space_id = ? AND project_id = ?").bind(spaceId, projectId).first<{ count: number }>();
    if ((usage?.count ?? 0) > 0) return json({ error: "此空間仍有預算項目，請先移動或刪除項目。" }, { status: 409 });
    await env.DB.prepare("DELETE FROM budget_spaces WHERE id = ? AND project_id = ?").bind(spaceId, projectId).run();
    await touchProject(projectId, env);
    return new Response(null, { status: 204 });
  }
  return json({ error: "不支援的方法" }, { status: 405 });
}

async function budgetItems(request: Request, env: Env, projectId: string, itemId?: string): Promise<Response> {
  if (!await findProject(projectId, env)) return json({ error: "找不到此工程案" }, { status: 404 });
  if (!itemId && request.method === "GET") {
    const result = await env.DB.prepare("SELECT id, space_id, category_id, name, quantity, unit_price, planned_amount, sort_order FROM budget_line_items WHERE project_id = ? ORDER BY space_id, sort_order, name").bind(projectId).all<Record<string, unknown>>();
    return json(result.results.map(mapBudgetItem));
  }
  if (!itemId && request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM budget_line_items WHERE project_id = ?").bind(projectId).run();
    await touchProject(projectId, env);
    return new Response(null, { status: 204 });
  }
  if (!itemId && request.method !== "POST") return json({ error: "找不到預算項目操作" }, { status: 404 });
  const existing = itemId ? await env.DB.prepare("SELECT id, space_id, category_id, name, quantity, unit_price, planned_amount, sort_order FROM budget_line_items WHERE id = ? AND project_id = ?").bind(itemId, projectId).first<Record<string, unknown>>() : null;
  if (itemId && !existing) return json({ error: "找不到此預算項目" }, { status: 404 });
  if (request.method === "POST" || request.method === "PATCH") {
    const input = parseBudgetItem(await requireJson(request));
    if (!input) return json({ error: "空間、項目、數量、單價或小計不正確" }, { status: 400 });
    const space = await env.DB.prepare("SELECT id FROM budget_spaces WHERE id = ? AND project_id = ?").bind(input.spaceId, projectId).first();
    if (!space) return json({ error: "請選擇正確的空間" }, { status: 400 });
    if (input.categoryId) {
      const category = await env.DB.prepare("SELECT id FROM budget_categories WHERE id = ? AND project_id = ?").bind(input.categoryId, projectId).first();
      if (!category) return json({ error: "分類不存在" }, { status: 400 });
    }
    const timestamp = now();
    if (!itemId) {
      const max = await env.DB.prepare("SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM budget_line_items WHERE space_id = ?").bind(input.spaceId).first<{ max_order: number }>();
      const id = newId();
      await env.DB.prepare("INSERT INTO budget_line_items (id, project_id, space_id, category_id, name, quantity, unit_price, planned_amount, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, projectId, input.spaceId, input.categoryId, input.name, input.quantity, input.unitPrice, input.plannedAmount, (max?.max_order ?? 0) + 1, timestamp, timestamp).run();
      await touchProject(projectId, env);
      const item = await env.DB.prepare("SELECT id, space_id, category_id, name, quantity, unit_price, planned_amount, sort_order FROM budget_line_items WHERE id = ?").bind(id).first<Record<string, unknown>>();
      return json(mapBudgetItem(item!), { status: 201 });
    }
    let sortOrder = Number(existing!.sort_order);
    if (existing!.space_id !== input.spaceId) {
      const max = await env.DB.prepare("SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM budget_line_items WHERE space_id = ?").bind(input.spaceId).first<{ max_order: number }>();
      sortOrder = (max?.max_order ?? 0) + 1;
    }
    await env.DB.prepare("UPDATE budget_line_items SET space_id = ?, category_id = ?, name = ?, quantity = ?, unit_price = ?, planned_amount = ?, sort_order = ?, updated_at = ? WHERE id = ? AND project_id = ?")
      .bind(input.spaceId, input.categoryId, input.name, input.quantity, input.unitPrice, input.plannedAmount, sortOrder, timestamp, itemId, projectId).run();
    await touchProject(projectId, env);
    const item = await env.DB.prepare("SELECT id, space_id, category_id, name, quantity, unit_price, planned_amount, sort_order FROM budget_line_items WHERE id = ?").bind(itemId).first<Record<string, unknown>>();
    return json(mapBudgetItem(item!));
  }
  if (request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM budget_line_items WHERE id = ? AND project_id = ?").bind(itemId, projectId).run();
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
    if ((usage?.count ?? 0) > 0) return json({ error: "已被帳務或移轉引用的人員只能停用" }, { status: 409 });
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
    const input = await resolveEntryPerson(env, projectId, parseEntry(await requireJson(request)));
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
      id, projectId, input.kind, input.status, null, input.description, input.amount, input.occurredOn,
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
    const input = await resolveEntryPerson(env, projectId, parseEntry(await requireJson(request)));
    if (input.categoryId) {
      const category = await env.DB.prepare(
        "SELECT id FROM budget_categories WHERE id = ? AND project_id = ?",
      ).bind(input.categoryId, projectId).first();
      if (!category) return json({ error: "找不到指定的預算分類" }, { status: 400 });
    }
    const timestamp = now();
    await env.DB.prepare(`
      UPDATE ledger_entries SET
        kind = ?, status = ?, refund_of_entry_id = NULL, description = ?, amount = ?, occurred_on = ?, category_id = ?,
        person_id = ?, counterparty = ?, payment_method = ?, note = ?, updated_at = ?
      WHERE id = ? AND project_id = ?
    `).bind(
      input.kind, input.status, input.description, input.amount, input.occurredOn, input.categoryId,
      input.personId, input.counterparty, input.paymentMethod, input.note, timestamp, entryId, projectId,
    ).run();
    await touchProject(projectId, env);
    const attachments = await env.DB.prepare(
      "SELECT id, entry_id, filename, content_type, size, created_at FROM attachments WHERE entry_id = ?",
    ).bind(entryId).all<Record<string, unknown>>();
    return json({ id: entryId, ...input, attachments: attachments.results.map(mapAttachment), updatedAt: timestamp });
  }
  if (request.method === "DELETE") {
    const attachments = await env.DB.prepare(`
      SELECT a.object_key
      FROM attachments a
      JOIN ledger_entries e ON e.id = a.entry_id
      WHERE e.project_id = ? AND (e.id = ? OR e.refund_of_entry_id = ?)
    `).bind(projectId, entryId, entryId).all<{ object_key: string }>();
    if (attachments.results.length) await env.RECEIPTS.delete(attachments.results.map((item) => item.object_key));
    await env.DB.batch([
      env.DB.prepare(`
        DELETE FROM attachments
        WHERE entry_id IN (
          SELECT id FROM ledger_entries WHERE project_id = ? AND (id = ? OR refund_of_entry_id = ?)
        )
      `).bind(projectId, entryId, entryId),
      env.DB.prepare(
        "DELETE FROM ledger_entries WHERE project_id = ? AND (id = ? OR refund_of_entry_id = ?)",
      ).bind(projectId, entryId, entryId),
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
      e.amount, e.status, e.counterparty, e.payment_method, e.note
    FROM ledger_entries e
    LEFT JOIN budget_categories c ON c.id = e.category_id
    WHERE e.project_id = ?
    ORDER BY e.occurred_on DESC
  `).bind(projectId).all<Record<string, unknown>>();
  const headers = ["日期", "類型", "品項", "分類", "金額", "狀態", "對象", "付款方式", "備註"];
  const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = "\uFEFF" + [
    headers,
    ...result.results.map((row) => [
      row.occurred_on, row.kind, row.description, row.category_name, row.amount,
      row.status, row.counterparty, row.payment_method, row.note,
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
    SELECT t.occurred_on,
      sender.name AS from_name, receiver.name AS to_name,
      t.status, t.amount, t.payment_method, t.note
    FROM fund_transfers t
    JOIN people sender ON sender.id = t.from_person_id
    JOIN people receiver ON receiver.id = t.to_person_id
    WHERE t.project_id = ?
    ORDER BY t.occurred_on DESC, t.created_at DESC
  `).bind(projectId).all<Record<string, unknown>>();
  const headers = ["日期", "轉出人", "轉入人", "狀態", "金額", "付款方式", "備註"];
  const statusLabels: Record<string, string> = { posted: "已完成", pending: "待處理", void: "已作廢" };
  const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = "\uFEFF" + [headers, ...result.results.map((row) => [
    row.occurred_on, row.from_name, row.to_name, statusLabels[String(row.status)] ?? row.status,
    row.amount, row.payment_method, row.note,
  ])].map((row) => row.map(quote).join(",")).join("\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename*=UTF-8''rainbow-project-transfers.csv",
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
  const ownerBudgetMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/owner-budget$/);
  if (ownerBudgetMatch) return ownerBudget(request, env, ownerBudgetMatch[1]);
  const budgetSpaceMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/budget-spaces(?:\/([^/]+))?$/);
  if (budgetSpaceMatch) return budgetSpaces(request, env, budgetSpaceMatch[1], budgetSpaceMatch[2]);
  const budgetItemMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/budget-items(?:\/([^/]+))?$/);
  if (budgetItemMatch) return budgetItems(request, env, budgetItemMatch[1], budgetItemMatch[2]);
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
