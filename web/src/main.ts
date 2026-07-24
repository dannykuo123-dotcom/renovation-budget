import "./style.css";
import { calculateTotals, categorySpent, formatMoney } from "./finance";
import { clearDemo, deleteCategory, deleteEntry, exportUrl, isDemoMode, loadDashboard, login, saveCategory, saveEntry, session, uploadAttachments } from "./api";
import type { Category, DashboardPayload, EntryKind, LedgerEntry } from "./types";

type View = "dashboard" | "budget" | "expenses" | "funding" | "settings";
let payload: DashboardPayload | null = null;
let view: View = "dashboard";
let query = "";
let filterCategory = "";
let filterStatus = "";
const app = document.querySelector<HTMLDivElement>("#app")!;

const esc = (value: string) => value.replace(/[&<>'\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
const dateLabel = (date: string) => new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric" }).format(new Date(`${date}T00:00:00`));
const categoryName = (id: string | null) => payload?.categories.find((category) => category.id === id)?.name ?? "未分類";
const kindLabel: Record<EntryKind, string> = { income: "資金入帳", expense: "支出", refund: "退款" };
const statusLabel: Record<LedgerEntry["status"], string> = { posted: "已入帳", pending: "待付款", void: "已作廢" };

function toast(message: string, tone = "success") {
  const element = document.createElement("div");
  element.className = `toast ${tone}`;
  element.textContent = message;
  document.body.append(element);
  setTimeout(() => element.remove(), 3000);
}

function showLogin(error = "") {
  app.innerHTML = `<main class="gate"><section class="gate-card"><div class="brand-mark">家</div><p class="eyebrow">RENOVATION BUDGET</p><h1>把每一筆裝修款<br>記得清清楚楚。</h1><p class="muted">輸入共用存取碼，查看這份裝修預算。</p>${isDemoMode ? '<p class="demo-note">目前為本機範例模式；部署後會自動連接雲端資料。</p>' : ""}<form id="login-form"><label>共用存取碼<input inputmode="numeric" autocomplete="current-password" name="code" type="password" maxlength="12" placeholder="輸入密碼" required autofocus /></label>${error ? `<p class="form-error">${esc(error)}</p>` : ""}<button class="primary wide" type="submit">進入帳務</button></form></section></main>`;
  document.querySelector<HTMLFormElement>("#login-form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget as HTMLFormElement;
    const form = new FormData(formElement);
    const button = formElement.querySelector("button")!;
    button.textContent = "驗證中…";
    button.setAttribute("disabled", "");
    try { await login(String(form.get("code"))); await refresh(); }
    catch (reason) { showLogin(reason instanceof Error ? reason.message : "無法登入"); }
  });
}

async function refresh() {
  try { payload = await loadDashboard(); render(); }
  catch (reason) {
    session.token = null;
    showLogin(reason instanceof Error ? reason.message : "工作階段已失效");
  }
}

function navItem(target: View, icon: string, label: string) {
  return `<button class="nav-item ${view === target ? "active" : ""}" data-view="${target}"><span>${icon}</span>${label}</button>`;
}

function layout(content: string) {
  const project = payload!.project;
  app.innerHTML = `<div class="shell"><aside class="sidebar"><div class="logo"><span>家</span><div><strong>家作帳</strong><small>裝修預算</small></div></div><nav>${navItem("dashboard", "⌂", "總覽")}${navItem("budget", "▦", "預算分類")}${navItem("expenses", "↗", "支出紀錄")}${navItem("funding", "＋", "資金入帳")}${navItem("settings", "⚙", "設定")}</nav><div class="sidebar-foot"><span class="live-dot"></span><small>${isDemoMode ? "範例資料模式" : "雲端資料已連線"}</small></div></aside><main class="main"><header class="topbar"><div><p class="eyebrow">${esc(project.name)}</p><h2>${view === "dashboard" ? "今日的資金狀況" : ({ budget: "預算分類", expenses: "支出紀錄", funding: "資金入帳", settings: "帳務設定" } as Record<View, string>)[view]}</h2></div><div class="top-actions"><button class="icon-button" data-action="refresh" aria-label="重新整理">↻</button><button class="avatar" data-action="logout" title="登出">登</button></div></header>${content}</main><nav class="mobile-nav">${navItem("dashboard", "⌂", "總覽")}${navItem("budget", "▦", "預算")}${navItem("expenses", "↗", "支出")}${navItem("funding", "＋", "入帳")}</nav></div>`;
  bindCommon();
}

function renderDashboard() {
  const totals = calculateTotals(payload!.categories, payload!.entries);
  const recent = [...payload!.entries].sort((a, b) => b.occurredOn.localeCompare(a.occurredOn)).slice(0, 5);
  const usage = totals.planned ? Math.min(100, Math.max(0, Math.round((totals.spent / totals.planned) * 100))) : 0;
  layout(`<section class="hero-grid"><article class="balance-card"><div><p>可用資金</p><h3>${formatMoney(totals.cashBalance)}</h3><span>${totals.received ? `已入帳 ${formatMoney(totals.received)}` : "等待第一筆入帳"}</span></div><div class="balance-orb">NT$</div></article><article class="metric-card"><p>預估總預算</p><h3>${formatMoney(totals.planned)}</h3><span>已使用 ${usage}%</span></article><article class="metric-card"><p>實際支出</p><h3>${formatMoney(totals.spent)}</h3><span class="negative">待付款 ${formatMoney(totals.pending)}</span></article><article class="metric-card"><p>預算餘額</p><h3>${formatMoney(totals.budgetRemaining)}</h3><span>${totals.budgetRemaining < 0 ? "已超出預算" : "尚可使用"}</span></article></section><section class="content-grid"><article class="panel budget-progress"><div class="panel-head"><div><p class="eyebrow">BUDGET HEALTH</p><h3>預算使用進度</h3></div><strong>${usage}%</strong></div><div class="progress-track"><i style="width:${usage}%"></i></div><div class="progress-meta"><span>已支出 ${formatMoney(totals.spent)}</span><span>預估 ${formatMoney(totals.planned)}</span></div><div class="category-bars">${payload!.categories.map((category) => { const spent = categorySpent(category.id, payload!.entries); const percent = category.plannedAmount ? Math.min(100, Math.max(0, Math.round(spent / category.plannedAmount * 100))) : 0; return `<div class="category-bar"><div><span class="color-dot" style="background:${category.color}"></span><strong>${esc(category.name)}</strong><small>${formatMoney(spent)} / ${formatMoney(category.plannedAmount)}</small></div><div class="mini-track"><i style="width:${percent}%;background:${category.color}"></i></div></div>`; }).join("") || '<p class="empty">尚未建立預算分類</p>'}</div></article><article class="panel recent"><div class="panel-head"><div><p class="eyebrow">RECENT ACTIVITY</p><h3>最新紀錄</h3></div><button class="text-button" data-view="expenses">查看全部</button></div><div class="activity-list">${recent.map((entry) => `<div class="activity"><div class="entry-icon ${entry.kind}">${entry.kind === "income" ? "↓" : entry.kind === "refund" ? "↩" : "↑"}</div><div><strong>${esc(entry.description)}</strong><small>${dateLabel(entry.occurredOn)} · ${esc(kindLabel[entry.kind])}</small></div><b class="${entry.kind === "income" ? "income" : ""}">${entry.kind === "income" ? "+" : entry.kind === "refund" ? "−" : "−"}${formatMoney(entry.amount)}</b></div>`).join("") || '<p class="empty">尚無帳務紀錄</p>'}</div></article></section>`);
}

function renderBudget() {
  layout(`<section class="page-actions"><p>規劃每一類工程的預估支出，系統會自動比對實際金額。</p><button class="primary" data-action="new-category">＋ 新增分類</button></section><section class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>分類</th><th>預估預算</th><th>實際支出</th><th>剩餘</th><th>使用率</th><th></th></tr></thead><tbody>${payload!.categories.map((category) => { const spent = categorySpent(category.id, payload!.entries); const percentage = category.plannedAmount ? Math.round(spent / category.plannedAmount * 100) : 0; return `<tr><td><span class="color-dot" style="background:${category.color}"></span>${esc(category.name)}</td><td>${formatMoney(category.plannedAmount)}</td><td>${formatMoney(spent)}</td><td class="${category.plannedAmount - spent < 0 ? "negative" : ""}">${formatMoney(category.plannedAmount - spent)}</td><td><div class="percentage"><i style="width:${Math.min(100, Math.max(0, percentage))}%;background:${category.color}"></i><span>${percentage}%</span></div></td><td class="row-actions"><button data-action="edit-category" data-id="${category.id}">編輯</button><button data-action="delete-category" data-id="${category.id}">刪除</button></td></tr>`; }).join("") || '<tr><td colspan="6" class="empty">還沒有分類，先新增一個預算分類吧。</td></tr>'}</tbody></table></div></section>`);
}

function entryFilters(entries: LedgerEntry[]) {
  return entries.filter((entry) => (!query || [entry.description, entry.counterparty, entry.note].join(" ").toLowerCase().includes(query.toLowerCase())) && (!filterCategory || entry.categoryId === filterCategory) && (!filterStatus || entry.status === filterStatus));
}

function renderExpenses(kind: "expenses" | "funding") {
  const isFunding = kind === "funding";
  const entries = entryFilters(payload!.entries.filter((entry) => isFunding ? entry.kind === "income" : entry.kind !== "income"));
  layout(`<section class="page-actions"><p>${isFunding ? "只記錄已實際收到的匯款，會直接增加可用資金。" : "管理已付款、待付款與退款，附件可用來保存收據或匯款截圖。"}</p><button class="primary" data-action="new-entry" data-kind="${isFunding ? "income" : "expense"}">＋ 新增${isFunding ? "入帳" : "支出"}</button></section><section class="filters panel"><label>搜尋<input id="search" placeholder="品項、對象或備註" value="${esc(query)}" /></label>${isFunding ? "" : `<label>分類<select id="category-filter"><option value="">全部分類</option>${payload!.categories.map((category) => `<option value="${category.id}" ${filterCategory === category.id ? "selected" : ""}>${esc(category.name)}</option>`).join("")}</select></label><label>狀態<select id="status-filter"><option value="">全部狀態</option><option value="posted" ${filterStatus === "posted" ? "selected" : ""}>已付款</option><option value="pending" ${filterStatus === "pending" ? "selected" : ""}>待付款</option><option value="void" ${filterStatus === "void" ? "selected" : ""}>已作廢</option></select></label>`}</section><section class="panel table-panel"><div class="table-wrap"><table class="entry-table"><thead><tr><th>日期</th><th>品項</th><th>${isFunding ? "來源" : "分類"}</th><th>付款方式</th><th>狀態</th><th>金額</th><th></th></tr></thead><tbody>${entries.sort((a, b) => b.occurredOn.localeCompare(a.occurredOn)).map((entry) => `<tr><td>${dateLabel(entry.occurredOn)}</td><td><strong>${esc(entry.description)}</strong>${entry.attachments.length ? `<small class="attachment-count">⌁ ${entry.attachments.length} 張憑證</small>` : ""}</td><td>${esc(isFunding ? entry.counterparty : categoryName(entry.categoryId))}</td><td>${esc(entry.paymentMethod || "—")}</td><td><span class="status ${entry.status}">${entry.kind === "refund" ? "退款" : statusLabel[entry.status]}</span></td><td class="amount ${entry.kind === "income" ? "income" : entry.kind === "refund" ? "refund" : ""}">${entry.kind === "income" ? "+" : entry.kind === "refund" ? "−" : "−"}${formatMoney(entry.amount)}</td><td class="row-actions"><button data-action="edit-entry" data-id="${entry.id}">編輯</button><button data-action="delete-entry" data-id="${entry.id}">刪除</button></td></tr>`).join("") || `<tr><td colspan="7" class="empty">目前沒有符合條件的紀錄。</td></tr>`}</tbody></table></div></section>`);
  document.querySelector<HTMLInputElement>("#search")?.addEventListener("input", (event) => { query = (event.target as HTMLInputElement).value; render(); });
  document.querySelector<HTMLSelectElement>("#category-filter")?.addEventListener("change", (event) => { filterCategory = (event.target as HTMLSelectElement).value; render(); });
  document.querySelector<HTMLSelectElement>("#status-filter")?.addEventListener("change", (event) => { filterStatus = (event.target as HTMLSelectElement).value; render(); });
}

function renderSettings() {
  layout(`<section class="settings-grid"><article class="panel setting-card"><p class="eyebrow">PROJECT</p><h3>${esc(payload!.project.name)}</h3><p class="muted">新臺幣（TWD） · 最後更新 ${new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short" }).format(new Date(payload!.project.updatedAt))}</p></article><article class="panel setting-card"><p class="eyebrow">EXPORT</p><h3>下載帳務紀錄</h3><p class="muted">CSV 可以直接用 Excel 或 Google 試算表開啟。</p>${isDemoMode ? '<button class="secondary" data-action="demo-export">下載範例 CSV</button>' : `<a class="secondary button-link" href="${exportUrl()}" target="_blank" rel="noreferrer">下載 CSV</a>`}</article><article class="panel setting-card danger-zone"><p class="eyebrow">DEMO DATA</p><h3>清除範例資料</h3><p class="muted">僅限本機範例模式。正式環境為了避免誤刪，共用資料需逐筆刪除。</p><button class="secondary danger" data-action="clear-demo" ${isDemoMode ? "" : "disabled"}>清除範例</button></article></section>`);
}

function render() {
  if (!payload) return showLogin();
  if (view === "dashboard") renderDashboard();
  else if (view === "budget") renderBudget();
  else if (view === "expenses" || view === "funding") renderExpenses(view);
  else renderSettings();
}

function openModal(content: string) {
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${content}</div>`;
  modal.addEventListener("click", (event) => { if (event.target === modal || (event.target as HTMLElement).closest("[data-action='close-modal']")) modal.remove(); });
  document.body.append(modal);
}

function openCategoryModal(existing?: Category) {
  openModal(`<div class="modal-head"><div><p class="eyebrow">BUDGET CATEGORY</p><h3>${existing ? "編輯分類" : "新增分類"}</h3></div><button class="icon-button" data-action="close-modal">×</button></div><form id="category-form" class="form-grid"><label>分類名稱<input name="name" maxlength="30" required value="${esc(existing?.name ?? "")}" placeholder="例如：木工工程" /></label><label>預估預算<input name="plannedAmount" type="number" min="0" step="1" required value="${existing?.plannedAmount ?? ""}" placeholder="0" /></label><label>識別顏色<input name="color" type="color" value="${existing?.color ?? "#1d6f63"}" /></label><div class="form-submit"><button type="button" class="secondary" data-action="close-modal">取消</button><button class="primary" type="submit">儲存分類</button></div></form>`);
  document.querySelector<HTMLFormElement>("#category-form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    try {
      await saveCategory({ name: String(form.get("name")).trim(), plannedAmount: Number(form.get("plannedAmount")), color: String(form.get("color")) }, existing?.id);
      document.querySelector(".modal-backdrop")?.remove(); await refresh(); toast("分類已儲存");
    } catch (reason) { toast(reason instanceof Error ? reason.message : "儲存失敗", "error"); }
  });
}

function openEntryModal(existing?: LedgerEntry, defaultKind: EntryKind = "expense") {
  const kind = existing?.kind ?? defaultKind;
  const categoryOptions = `<option value="">不指定分類</option>${payload!.categories.map((category) => `<option value="${category.id}" ${(existing?.categoryId ?? "") === category.id ? "selected" : ""}>${esc(category.name)}</option>`).join("")}`;
  openModal(`<div class="modal-head"><div><p class="eyebrow">${kindLabel[kind]}</p><h3>${existing ? "編輯紀錄" : `新增${kindLabel[kind]}`}</h3></div><button class="icon-button" data-action="close-modal">×</button></div><form id="entry-form" class="form-grid"><label>紀錄類型<select name="kind" id="entry-kind"><option value="expense" ${kind === "expense" ? "selected" : ""}>支出</option><option value="income" ${kind === "income" ? "selected" : ""}>資金入帳</option><option value="refund" ${kind === "refund" ? "selected" : ""}>退款</option></select></label><label>品項／用途<input name="description" maxlength="80" required value="${esc(existing?.description ?? "")}" placeholder="例如：木地板訂金" /></label><label>金額<input name="amount" type="number" min="1" step="1" required value="${existing?.amount ?? ""}" /></label><label>日期<input name="occurredOn" type="date" required value="${existing?.occurredOn ?? new Date().toISOString().slice(0, 10)}" /></label><label>預算分類<select name="categoryId">${categoryOptions}</select></label><label>對象<input name="counterparty" maxlength="60" value="${esc(existing?.counterparty ?? "")}" placeholder="廠商或匯款人" /></label><label>付款方式<select name="paymentMethod"><option value="">未指定</option>${["銀行轉帳", "現金", "信用卡", "電子支付"].map((method) => `<option ${existing?.paymentMethod === method ? "selected" : ""}>${method}</option>`).join("")}</select></label><label>狀態<select name="status"><option value="posted" ${existing?.status === "posted" || !existing ? "selected" : ""}>已入帳／已付款</option><option value="pending" ${existing?.status === "pending" ? "selected" : ""}>待付款</option><option value="void" ${existing?.status === "void" ? "selected" : ""}>已作廢</option></select></label><label class="full">備註<textarea name="note" maxlength="500" placeholder="例如：保固、報價或付款說明">${esc(existing?.note ?? "")}</textarea></label>${existing?.kind !== "income" || !existing ? '<label class="full upload-field">憑證照片（JPG、PNG、WebP；最多 5 張，每張 10MB）<input name="files" type="file" accept="image/jpeg,image/png,image/webp" multiple /></label>' : ""}<div class="form-submit"><button type="button" class="secondary" data-action="close-modal">取消</button><button class="primary" type="submit">儲存紀錄</button></div></form>`);
  document.querySelector<HTMLFormElement>("#entry-form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget as HTMLFormElement;
    const form = new FormData(formElement);
    const files = [...(formElement.querySelector<HTMLInputElement>("[name='files']")?.files ?? [])];
    if (files.length > 5 || files.some((file) => file.size > 10 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type))) return toast("附件限 5 張 JPG、PNG、WebP，且每張不得超過 10MB。", "error");
    try {
      const result = await saveEntry({ kind: String(form.get("kind")) as EntryKind, status: String(form.get("status")) as LedgerEntry["status"], description: String(form.get("description")).trim(), amount: Number(form.get("amount")), occurredOn: String(form.get("occurredOn")), categoryId: String(form.get("categoryId")) || null, counterparty: String(form.get("counterparty")).trim(), paymentMethod: String(form.get("paymentMethod")), note: String(form.get("note")).trim() }, existing?.id);
      await uploadAttachments(result.id, files);
      document.querySelector(".modal-backdrop")?.remove(); await refresh(); toast("紀錄已儲存");
    } catch (reason) { toast(reason instanceof Error ? reason.message : "儲存失敗", "error"); }
  });
}

function exportDemoCsv() {
  const rows = [["日期", "類型", "品項", "分類", "金額", "狀態", "對象", "付款方式", "備註"], ...payload!.entries.map((entry) => [entry.occurredOn, kindLabel[entry.kind], entry.description, categoryName(entry.categoryId), String(entry.amount), statusLabel[entry.status], entry.counterparty, entry.paymentMethod, entry.note])];
  const blob = new Blob(["\uFEFF" + rows.map((row) => row.map((item) => `"${item.replaceAll('"', '""')}"`).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "裝修帳務範例.csv"; link.click(); URL.revokeObjectURL(url);
}

function bindCommon() {
  document.querySelectorAll<HTMLElement>("[data-view]").forEach((button) => button.addEventListener("click", () => { view = button.dataset.view as View; query = ""; filterCategory = ""; filterStatus = ""; render(); }));
  document.querySelectorAll<HTMLElement>("[data-action]").forEach((button) => button.addEventListener("click", async () => {
    const action = button.dataset.action;
    if (action === "logout") { session.token = null; payload = null; showLogin(); }
    if (action === "refresh") { await refresh(); toast("資料已更新"); }
    if (action === "new-category") openCategoryModal();
    if (action === "edit-category") openCategoryModal(payload!.categories.find((category) => category.id === button.dataset.id));
    if (action === "delete-category") {
      if (confirm("確定刪除此分類嗎？已被支出使用的分類不能直接刪除。")) try { await deleteCategory(button.dataset.id!); await refresh(); toast("分類已刪除"); } catch (reason) { toast(reason instanceof Error ? reason.message : "刪除失敗", "error"); }
    }
    if (action === "new-entry") openEntryModal(undefined, button.dataset.kind as EntryKind);
    if (action === "edit-entry") openEntryModal(payload!.entries.find((entry) => entry.id === button.dataset.id));
    if (action === "delete-entry") {
      if (confirm("確定刪除此筆紀錄與其附件嗎？")) try { await deleteEntry(button.dataset.id!); await refresh(); toast("紀錄已刪除"); } catch (reason) { toast(reason instanceof Error ? reason.message : "刪除失敗", "error"); }
    }
    if (action === "demo-export") exportDemoCsv();
    if (action === "clear-demo" && confirm("這會清除目前範例資料，確定嗎？")) { await clearDemo(); await refresh(); toast("範例資料已清除"); }
  }));
}

showLogin();
