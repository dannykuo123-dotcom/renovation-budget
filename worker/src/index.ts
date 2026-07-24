export interface Env {
  DB: D1Database;
  RECEIPTS: R2Bucket;
  ALLOWED_ORIGIN: string;
  BUDGET_ACCESS_CODE: string;
  SESSION_SIGNING_SECRET: string;
}

type EntryKind = "income" | "expense" | "refund";
type EntryStatus = "posted" | "pending" | "refunded" | "void";
type ProjectStatus = "active" | "completed" | "archived";
type EntryInput = {
  kind: EntryKind;
  status: EntryStatus;
  description: string;
  amount: number;
  occurredOn: string;
  categoryId: string | null;
  counterparty: string;
  paymentMethod: string;
  note: string;
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
    !["posted", "pending", "refunded", "void"].includes(String(status)) ||
    !amount ||
    !/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)
  ) {
    throw new Error("紀錄資料不完整或格式錯誤");
  }
  const description = text(input.description, 80);
  if (!description) throw new Error("請輸入品項或用途");
  if (status === "refunded" && kind !== "expense") throw new Error("只有支出紀錄可標記為已退款");
  return {
    kind: kind as EntryKind,
    status: status as EntryStatus,
    description,
    amount,
    occurredOn,
    categoryId: typeof input.categoryId === "string" && input.categoryId ? input.categoryId : null,
    counterparty: text(input.counterparty, 60),
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

const mapCategory = (row: Record<string, unknown>) => ({
  id: row.id,
  name: row.name,
  plannedAmount: row.planned_amount,
  color: row.color,
  sortOrder: row.sort_order,
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
  counterparty: row.counterparty,
  paymentMethod: row.payment_method,
  note: row.note,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  attachments: attachments.filter((attachment) => attachment.entry_id === row.id).map(mapAttachment),
});

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
  const [project, categoryResult, entryResult, attachmentResult] = await Promise.all([
    findProject(projectId, env),
    env.DB.prepare(
      "SELECT id, name, planned_amount, color, sort_order FROM budget_categories WHERE project_id = ? ORDER BY sort_order, name",
    ).bind(projectId).all<Record<string, unknown>>(),
    env.DB.prepare(
      "SELECT * FROM ledger_entries WHERE project_id = ? ORDER BY occurred_on DESC, created_at DESC",
    ).bind(projectId).all<Record<string, unknown>>(),
    env.DB.prepare(
      "SELECT a.id, a.entry_id, a.filename, a.content_type, a.size, a.created_at FROM attachments a JOIN ledger_entries e ON e.id = a.entry_id WHERE e.project_id = ?",
    ).bind(projectId).all<Record<string, unknown>>(),
  ]);
  if (!project) return json({ error: "找不到此工程案" }, { status: 404 });
  return json({
    project: mapProject(project),
    categories: categoryResult.results.map(mapCategory),
    entries: entryResult.results.map((entry) => mapEntry(entry, attachmentResult.results)),
  });
}

async function categories(request: Request, env: Env, projectId: string, categoryId?: string): Promise<Response> {
  if (!await findProject(projectId, env)) return json({ error: "找不到此工程案" }, { status: 404 });
  if (!categoryId && request.method === "GET") {
    const result = await env.DB.prepare(
      "SELECT id, name, planned_amount, color, sort_order FROM budget_categories WHERE project_id = ? ORDER BY sort_order, name",
    ).bind(projectId).all<Record<string, unknown>>();
    return json(result.results.map(mapCategory));
  }
  if (!categoryId && request.method === "POST") {
    const body = await requireJson(request);
    const name = text(body.name, 30);
    const plannedAmount =
      typeof body.plannedAmount === "number" && Number.isSafeInteger(body.plannedAmount) && body.plannedAmount >= 0
        ? body.plannedAmount
        : null;
    const color = /^#[0-9a-fA-F]{6}$/.test(String(body.color)) ? String(body.color) : "#1d6f63";
    if (!name || plannedAmount === null) return json({ error: "分類名稱或預算不正確" }, { status: 400 });
    const max = await env.DB.prepare(
      "SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM budget_categories WHERE project_id = ?",
    ).bind(projectId).first<{ max_order: number }>();
    const id = newId();
    const timestamp = now();
    await env.DB.prepare(
      "INSERT INTO budget_categories (id, project_id, name, planned_amount, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, projectId, name, plannedAmount, color, (max?.max_order ?? 0) + 1, timestamp, timestamp).run();
    await touchProject(projectId, env);
    return json({ id, name, plannedAmount, color, sortOrder: (max?.max_order ?? 0) + 1 }, { status: 201 });
  }
  if (!categoryId) return json({ error: "找不到分類操作" }, { status: 404 });
  const existing = await env.DB.prepare(
    "SELECT id FROM budget_categories WHERE id = ? AND project_id = ?",
  ).bind(categoryId, projectId).first();
  if (!existing) return json({ error: "找不到此分類" }, { status: 404 });
  if (request.method === "PATCH") {
    const body = await requireJson(request);
    const name = text(body.name, 30);
    const plannedAmount =
      typeof body.plannedAmount === "number" && Number.isSafeInteger(body.plannedAmount) && body.plannedAmount >= 0
        ? body.plannedAmount
        : null;
    const color = /^#[0-9a-fA-F]{6}$/.test(String(body.color)) ? String(body.color) : "#1d6f63";
    if (!name || plannedAmount === null) return json({ error: "分類名稱或預算不正確" }, { status: 400 });
    await env.DB.prepare(
      "UPDATE budget_categories SET name = ?, planned_amount = ?, color = ?, updated_at = ? WHERE id = ? AND project_id = ?",
    ).bind(name, plannedAmount, color, now(), categoryId, projectId).run();
    await touchProject(projectId, env);
    const category = await env.DB.prepare(
      "SELECT id, name, planned_amount, color, sort_order FROM budget_categories WHERE id = ?",
    ).bind(categoryId).first<Record<string, unknown>>();
    return json(mapCategory(category!));
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
    const input = parseEntry(await requireJson(request));
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
        (id, project_id, kind, status, description, amount, occurred_on, category_id, counterparty, payment_method, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, projectId, input.kind, input.status, input.description, input.amount, input.occurredOn,
      input.categoryId, input.counterparty, input.paymentMethod, input.note, timestamp, timestamp,
    ).run();
    await touchProject(projectId, env);
    return json({ id, ...input, attachments: [], createdAt: timestamp, updatedAt: timestamp }, { status: 201 });
  }
  if (!entryId) return json({ error: "找不到帳務操作" }, { status: 404 });
  const existing = await env.DB.prepare(
    "SELECT id FROM ledger_entries WHERE id = ? AND project_id = ?",
  ).bind(entryId, projectId).first();
  if (!existing) return json({ error: "找不到此紀錄" }, { status: 404 });
  if (request.method === "PATCH") {
    const input = parseEntry(await requireJson(request));
    if (input.categoryId) {
      const category = await env.DB.prepare(
        "SELECT id FROM budget_categories WHERE id = ? AND project_id = ?",
      ).bind(input.categoryId, projectId).first();
      if (!category) return json({ error: "找不到指定的預算分類" }, { status: 400 });
    }
    const timestamp = now();
    await env.DB.prepare(`
      UPDATE ledger_entries SET
        kind = ?, status = ?, description = ?, amount = ?, occurred_on = ?, category_id = ?,
        counterparty = ?, payment_method = ?, note = ?, updated_at = ?
      WHERE id = ? AND project_id = ?
    `).bind(
      input.kind, input.status, input.description, input.amount, input.occurredOn, input.categoryId,
      input.counterparty, input.paymentMethod, input.note, timestamp, entryId, projectId,
    ).run();
    await touchProject(projectId, env);
    const attachments = await env.DB.prepare(
      "SELECT id, entry_id, filename, content_type, size, created_at FROM attachments WHERE entry_id = ?",
    ).bind(entryId).all<Record<string, unknown>>();
    return json({ id: entryId, ...input, attachments: attachments.results.map(mapAttachment), updatedAt: timestamp });
  }
  if (request.method === "DELETE") {
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
  const categoryMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/categories(?:\/([^/]+))?$/);
  if (categoryMatch) return categories(request, env, categoryMatch[1], categoryMatch[2]);
  const uploadMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/entries\/([^/]+)\/attachments$/);
  if (uploadMatch) return attachmentRoutes(request, env, uploadMatch[1], uploadMatch[2]);
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
