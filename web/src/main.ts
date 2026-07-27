import "./style.css";
import {
  ApiError,
  createProject,
  deleteCategory,
  deleteEntry,
  downloadProjectCsv,
  downloadCashflowCsv,
  deletePerson,
  deleteTransfer,
  isDemoMode,
  loadDashboard,
  loadProjects,
  savePerson,
  saveTransfer,
  login,
  saveCategory,
  saveEntry,
  session,
  setProjectArchived,
  updateProject,
  uploadAttachments,
} from "./api";
import { calculatePersonCashflows, calculateTotals, categorySpent, formatMoney } from "./finance";
import { parseRoute, projectRoute, projectsRoute, type ProjectView } from "./router";
import type {
  Category,
  DashboardPayload,
  FundTransfer,
  Person,
  EntryKind,
  LedgerEntry,
  Project,
  ProjectStatus,
  ProjectSummary,
} from "./types";

let projects: ProjectSummary[] = [];
let payload: DashboardPayload | null = null;
let query = "";
let filterCategory = "";
let filterStatus = "";
let mobileFiltersOpen = false;
let loading = false;
type CashflowTab = "overview" | "records" | "people";
let cashflowTab: CashflowTab = "overview";
let cashflowPersonFilter = "";
let cashflowStatusFilter = "";
let cashflowTypeFilter = "";
type SortDirection = "asc" | "desc";
type BudgetSortKey = "sortOrder" | "name" | "planned" | "spent" | "remaining" | "percentage";
type EntrySortKey = "occurredOn" | "description" | "category" | "counterparty" | "paymentMethod" | "status" | "amount";
let budgetSortKey: BudgetSortKey = "sortOrder";
let budgetSortDirection: SortDirection = "asc";
let entrySortKey: EntrySortKey = "occurredOn";
let entrySortDirection: SortDirection = "desc";
const app = document.querySelector<HTMLDivElement>("#app")!;

const esc = (value: string) =>
  value.replace(/[&<>'"]/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric" }).format(new Date(`${date}T00:00:00`));
const kindLabel: Record<EntryKind, string> = { income: "資金入帳", expense: "支出", refund: "退款" };
const projectStatusLabel: Record<ProjectStatus, string> = {
  active: "進行中",
  completed: "已完工",
  archived: "已封存",
};

function currentProjectId(): string {
  const route = parseRoute(location.hash);
  if (route.kind !== "project") throw new Error("尚未選擇工程案");
  return route.projectId;
}

function categoryName(id: string | null): string {
  return payload?.categories.find((category) => category.id === id)?.name ?? "未分類";
}
function personById(id: string | null): Person | undefined {
  return payload?.people.find((person) => person.id === id);
}

function personName(id: string | null): string {
  const person = personById(id);
  return person ? `${person.name}${person.role ? `（${person.role}）` : ""}` : "未指定人員";
}

function activePersonOptions(selectedId: string | null, includeInactive = false): string {
  const people = payload!.people.filter((person) => person.active || person.id === selectedId || includeInactive);
  return `<option value="">請選擇人員</option>${people.map((person) =>
    `<option value="${person.id}" ${person.id === selectedId ? "selected" : ""}>${esc(person.name)}${person.role ? `（${esc(person.role)}）` : ""}${person.active ? "" : "（已停用）"}</option>`,
  ).join("")}`;
}

function isReturned(entry: LedgerEntry): boolean {
  return entry.kind === "refund" && entry.status === "posted";
}

function isRefund(entry: LedgerEntry): boolean {
  return entry.kind === "refund";
}

function entryAmountSign(entry: LedgerEntry): string {
  return entry.kind === "income" || isRefund(entry) ? "+" : "−";
}

function entryAmountClass(entry: LedgerEntry): string {
  if (entry.kind === "income") return "income";
  if (isReturned(entry)) return "returned";
  if (isRefund(entry)) return "refund";
  return "";
}

function entryStatusText(entry: LedgerEntry): string {
  if (entry.status === "void") return "已作廢";
  if (entry.kind === "income") return "已入帳";
  if (entry.kind === "refund") return entry.status === "posted" ? "已退款" : "待退款";
  return entry.status === "posted" ? "已付款" : "待付款";
}

function entryStatusClass(entry: LedgerEntry): string {
  return isReturned(entry) ? "refunded" : entry.status;
}

function originalExpense(entry: LedgerEntry): LedgerEntry | undefined {
  return entry.refundOfEntryId ? payload?.entries.find((item) => item.id === entry.refundOfEntryId) : undefined;
}

function refundReserved(sourceId: string, exceptId?: string): number {
  return payload!.entries
    .filter((entry) => entry.kind === "refund" && entry.refundOfEntryId === sourceId && entry.id !== exceptId && entry.status !== "void")
    .reduce((sum, entry) => sum + entry.amount, 0);
}

function sortIndicator(key: string, currentKey: string, direction: SortDirection): string {
  return key === currentKey ? (direction === "asc" ? "↑" : "↓") : "↕";
}

function compareSortValue(left: string | number, right: string | number): number {
  return typeof left === "string" ? left.localeCompare(String(right), "zh-Hant") : left - Number(right);
}

function toast(message: string, tone = "success") {
  const element = document.createElement("div");
  element.className = `toast ${tone}`;
  element.textContent = message;
  document.body.append(element);
  setTimeout(() => element.remove(), 3000);
}

function showLoading() {
  app.innerHTML = `<main class="loading-screen"><div class="brand-mark">虹</div><p>正在載入彩虹水電工程資料…</p></main>`;
}

function showLogin(error = "") {
  app.innerHTML = `
    <main class="gate">
      <section class="gate-card">
        <div class="brand-mark">虹</div>
        <p class="eyebrow">RAINBOW ELECTRIC</p>
        <h1>每一筆工程款，<br>都清清楚楚。</h1>
        <p class="muted">輸入共用存取碼，進入彩虹水電工程帳務。</p>
        ${isDemoMode ? '<p class="demo-note">目前為本機模式，資料只保存在這個分頁。</p>' : ""}
        <form id="login-form">
          <label>共用存取碼
            <input inputmode="numeric" autocomplete="current-password" name="code" type="password"
              maxlength="12" placeholder="輸入存取碼" required autofocus />
          </label>
          ${error ? `<p class="form-error">${esc(error)}</p>` : ""}
          <button class="primary wide" type="submit">進入工程帳務</button>
        </form>
      </section>
    </main>`;
  document.querySelector<HTMLFormElement>("#login-form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget as HTMLFormElement;
    const button = formElement.querySelector("button")!;
    button.textContent = "驗證中…";
    button.setAttribute("disabled", "");
    try {
      await login(String(new FormData(formElement).get("code")));
      if (!location.hash) location.hash = projectsRoute();
      await refresh();
    } catch (reason) {
      showLogin(reason instanceof Error ? reason.message : "無法登入");
    }
  });
}

async function refresh() {
  if (loading) return;
  loading = true;
  showLoading();
  const route = parseRoute(location.hash);
  try {
    if (route.kind === "projects") {
      payload = null;
      projects = await loadProjects();
      renderProjectList();
    } else {
      payload = await loadDashboard(route.projectId);
      renderProjectPage(route.view);
    }
  } catch (reason) {
    if (reason instanceof ApiError && reason.status === 401) {
      session.token = null;
      showLogin("登入已逾時，請重新輸入存取碼。");
    } else if (reason instanceof ApiError && reason.status === 404 && route.kind === "project") {
      location.hash = projectsRoute();
      toast("找不到此工程案", "error");
    } else {
      app.innerHTML = `<main class="error-screen"><h1>資料暫時無法載入</h1><p>${esc(reason instanceof Error ? reason.message : "請稍後再試")}</p><button class="primary" id="retry">重新整理</button></main>`;
      document.querySelector("#retry")?.addEventListener("click", () => refresh());
    }
  } finally {
    loading = false;
  }
}

function renderProjectList() {
  const active = projects.filter((project) => project.status !== "archived");
  const archived = projects.filter((project) => project.status === "archived");
  app.innerHTML = `
    <div class="projects-page">
      <header class="projects-header">
        <a class="wordmark" href="${projectsRoute()}">
          <span>虹</span><div><strong>彩虹水電</strong><small>工程預算管理</small></div>
        </a>
        <div class="top-actions">
          <button class="icon-button" data-action="refresh" aria-label="重新整理">↻</button>
          <button class="avatar" data-action="logout" title="登出">登</button>
        </div>
      </header>
      <main class="projects-main">
        <section class="projects-title">
          <div><p class="eyebrow">PROJECTS</p><h1>工程案</h1><p>每個案場都有獨立的預算、收支與憑證。</p></div>
          <button class="primary" data-action="new-project">＋ 建立工程案</button>
        </section>
        ${active.length ? `<section class="project-grid">${active.map(projectCard).join("")}</section>` : `
          <section class="empty-projects">
            <div class="empty-illustration">＋</div>
            <p class="eyebrow">START HERE</p>
            <h2>建立第一個工程案</h2>
            <p>輸入工程名稱與地址，就能開始編預算、記支出與保存憑證。</p>
            <button class="primary" data-action="new-project">建立第一個工程案</button>
          </section>`}
        ${archived.length ? `
          <section class="archived-section">
            <div class="section-heading"><h2>已封存工程</h2><span>${archived.length} 案</span></div>
            <div class="project-grid archived-grid">${archived.map(projectCard).join("")}</div>
          </section>` : ""}
      </main>
    </div>`;
  bindCommon();
}

function projectCard(project: ProjectSummary): string {
  const cashBalance = project.received - project.spent;
  return `
    <article class="project-card ${project.status === "archived" ? "is-archived" : ""}">
      <div class="project-card-head">
        <span class="project-status ${project.status}">${projectStatusLabel[project.status]}</span>
        <button class="card-menu" data-action="${project.status === "archived" ? "restore-project" : "archive-project"}"
          data-id="${project.id}">${project.status === "archived" ? "重新啟用" : "封存"}</button>
      </div>
      <a class="project-card-link" href="${projectRoute(project.id)}">
        <h2>${esc(project.name)}</h2>
        <p class="project-address">${project.address ? `⌖ ${esc(project.address)}` : "尚未填寫工程地址"}</p>
        <div class="project-money">
          <div><small>預估預算</small><strong>${formatMoney(project.planned)}</strong></div>
          <div><small>可用資金</small><strong class="${cashBalance < 0 ? "negative" : ""}">${formatMoney(cashBalance)}</strong></div>
          <div><small>實際支出</small><strong>${formatMoney(project.spent)}</strong></div>
        </div>
        <span class="open-project">開啟工程案 →</span>
      </a>
    </article>`;
}

function navLink(view: ProjectView, icon: string, label: string, current: ProjectView) {
  return `<a class="nav-item ${view === current ? "active" : ""}" href="${projectRoute(currentProjectId(), view)}"><span>${icon}</span>${label}</a>`;
}

function layout(content: string, view: ProjectView) {
  const project = payload!.project;
  const title: Record<ProjectView, string> = {
    dashboard: "工程資金總覽",
    budget: "預算分類",
    expenses: "支出紀錄",
    funding: "資金入帳",
    cashflow: "\u8cc7\u91d1\u6d41",
    settings: "工程設定",
  };
  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <a class="logo" href="${projectsRoute()}">
          <span>虹</span><div><strong>彩虹水電</strong><small>工程預算管理</small></div>
        </a>
        <a class="project-switcher" href="${projectsRoute()}"><small>目前工程</small><strong>${esc(project.name)}</strong><span>切換工程 ›</span></a>
        <nav>
          ${navLink("dashboard", "⌂", "總覽", view)}
          ${navLink("budget", "▦", "預算分類", view)}
          ${navLink("expenses", "↗", "支出紀錄", view)}
          ${navLink("cashflow", "&#8644;", "\u8cc7\u91d1\u6d41", view)}
          ${navLink("funding", "＋", "資金入帳", view)}
          ${navLink("settings", "⚙", "工程設定", view)}
        </nav>
        <div class="sidebar-foot"><span class="live-dot"></span><small>${isDemoMode ? "本機資料模式" : "雲端資料已連線"}</small></div>
      </aside>
      <main class="main">
        <header class="topbar">
          <div><a class="mobile-back" href="${projectsRoute()}">‹ 所有工程</a><p class="eyebrow">${esc(project.name)}</p><h2>${title[view]}</h2></div>
          <div class="top-actions">
            <button class="icon-button" data-action="refresh" aria-label="重新整理">↻</button>
            <button class="avatar" data-action="logout" title="登出">登</button>
          </div>
        </header>
        ${content}
      </main>
      <nav class="mobile-nav">
        ${navLink("dashboard", "⌂", "總覽", view)}
        ${navLink("budget", "▦", "預算", view)}
        ${navLink("cashflow", "&#8644;", "\u8cc7\u91d1\u6d41", view)}
        ${navLink("expenses", "↗", "支出", view)}
        ${navLink("funding", "＋", "入帳", view)}
        ${navLink("settings", "•••", "更多", view)}
      </nav>
    </div>`;
  bindCommon();
}

function renderDashboard() {
  const totals = calculateTotals(payload!.categories, payload!.entries);
  const recent = [...payload!.entries].sort((a, b) => b.occurredOn.localeCompare(a.occurredOn)).slice(0, 5);
  const usage = totals.planned ? Math.min(100, Math.max(0, Math.round(totals.spent / totals.planned * 100))) : 0;
  const refundSummary = [
    totals.returned ? `已退回 +${formatMoney(totals.returned)}` : "",
    totals.pendingRefund ? `待退款 ${formatMoney(totals.pendingRefund)}` : "",
  ].filter(Boolean).join(" · ") || `待付款 ${formatMoney(totals.pending)}`;
  layout(`
    <section class="hero-grid">
      <article class="balance-card"><div><p>可用資金</p><h3>${formatMoney(totals.cashBalance)}</h3><span>${totals.received ? `已入帳 ${formatMoney(totals.received)}` : "等待第一筆入帳"}</span></div><div class="balance-orb">NT$</div></article>
      <article class="metric-card"><p>預估總預算</p><h3>${formatMoney(totals.planned)}</h3><span>已使用 ${usage}%</span></article>
      <article class="metric-card"><p>實際支出</p><h3>${formatMoney(totals.spent)}</h3><span class="${totals.returned ? "returned" : totals.pendingRefund ? "refund" : "negative"}">${refundSummary}</span></article>
      <article class="metric-card"><p>預算餘額</p><h3>${formatMoney(totals.budgetRemaining)}</h3><span>${totals.budgetRemaining < 0 ? "已超出預算" : "尚可使用"}</span></article>
    </section>
    <section class="content-grid">
      <article class="panel budget-progress">
        <div class="panel-head"><div><p class="eyebrow">BUDGET HEALTH</p><h3>預算使用進度</h3></div><strong>${usage}%</strong></div>
        <div class="progress-track"><i style="width:${usage}%"></i></div>
        <div class="progress-meta"><span>已支出 ${formatMoney(totals.spent)}</span><span>預估 ${formatMoney(totals.planned)}</span></div>
        <div class="category-bars">${payload!.categories.map((category) => {
          const spent = categorySpent(category.id, payload!.entries);
          const percent = category.plannedAmount ? Math.min(100, Math.max(0, Math.round(spent / category.plannedAmount * 100))) : 0;
          return `<div class="category-bar"><div><span class="color-dot" style="background:${category.color}"></span><strong>${esc(category.name)}</strong><small>${formatMoney(spent)} / ${formatMoney(category.plannedAmount)}</small></div><div class="mini-track"><i style="width:${percent}%;background:${category.color}"></i></div></div>`;
        }).join("") || '<p class="empty">尚未建立預算分類</p>'}</div>
      </article>
      <article class="panel recent">
        <div class="panel-head"><div><p class="eyebrow">RECENT ACTIVITY</p><h3>最新紀錄</h3></div><a class="text-button" href="${projectRoute(currentProjectId(), "expenses")}">查看全部</a></div>
        <div class="activity-list">${recent.map((entry) => `
          <div class="activity"><div class="entry-icon ${isRefund(entry) ? "refund" : entry.kind}">${entry.kind === "income" ? "↓" : isRefund(entry) ? "↩" : "↑"}</div><div><strong>${esc(entry.description)}</strong><small>${dateLabel(entry.occurredOn)} · ${esc(entryStatusText(entry))}</small></div><b class="${entryAmountClass(entry)}">${entryAmountSign(entry)}${formatMoney(entry.amount)}</b></div>`).join("") || '<p class="empty">尚無帳務紀錄</p>'}</div>
      </article>
    </section>`, "dashboard");
}

function renderBudget() {
  const rows = payload!.categories.map((category) => {
    const spent = categorySpent(category.id, payload!.entries);
    const percentage = category.plannedAmount ? Math.round(spent / category.plannedAmount * 100) : 0;
    return { category, spent, percentage };
  }).sort((left, right) => {
    const value = (row: typeof left): string | number => {
      if (budgetSortKey === "sortOrder") return row.category.sortOrder;
      if (budgetSortKey === "name") return row.category.name;
      if (budgetSortKey === "planned") return row.category.plannedAmount;
      if (budgetSortKey === "spent") return row.spent;
      if (budgetSortKey === "remaining") return row.category.plannedAmount - row.spent;
      return row.percentage;
    };
    const compare = compareSortValue(value(left), value(right));
    return budgetSortDirection === "asc" ? compare : -compare;
  });
  layout(`
    <section class="page-actions"><p>規劃各類工程的預估支出，並自動比對實際金額。</p><button class="primary" data-action="new-category">＋ 新增分類</button></section>
    <section class="panel table-panel desktop-table"><div class="table-wrap"><table><thead><tr><th><button class="sort-button" data-sort-budget="name">分類 ${sortIndicator("name", budgetSortKey, budgetSortDirection)}</button></th><th><button class="sort-button" data-sort-budget="planned">預估預算 ${sortIndicator("planned", budgetSortKey, budgetSortDirection)}</button></th><th><button class="sort-button" data-sort-budget="spent">實際支出 ${sortIndicator("spent", budgetSortKey, budgetSortDirection)}</button></th><th><button class="sort-button" data-sort-budget="remaining">剩餘 ${sortIndicator("remaining", budgetSortKey, budgetSortDirection)}</button></th><th><button class="sort-button" data-sort-budget="percentage">使用率 ${sortIndicator("percentage", budgetSortKey, budgetSortDirection)}</button></th><th></th></tr></thead><tbody>
      ${rows.map(({ category, spent, percentage }) => `<tr><td><span class="color-dot" style="background:${category.color}"></span><strong class="budget-category-name">${esc(category.name)}</strong>${category.items.length ? `<div class="budget-item-list">${category.items.map((item) => `<span>${esc(item.name)} <b>${formatMoney(item.plannedAmount)}</b></span>`).join("")}</div>` : '<small class="budget-item-empty">尚未設定細項</small>'}</td><td>${formatMoney(category.plannedAmount)}</td><td>${formatMoney(spent)}</td><td class="${category.plannedAmount - spent < 0 ? "negative" : ""}">${formatMoney(category.plannedAmount - spent)}</td><td><div class="percentage"><i style="width:${Math.min(100, Math.max(0, percentage))}%;background:${category.color}"></i><span>${percentage}%</span></div></td><td class="row-actions"><button data-action="edit-category" data-id="${category.id}">編輯</button><button data-action="delete-category" data-id="${category.id}">刪除</button></td></tr>`).join("") || '<tr><td colspan="6" class="empty">還沒有分類，先新增一個預算分類吧。</td></tr>'}
    </tbody></table></div></section>
    <section class="mobile-record-list">${rows.map(({ category, spent, percentage }) => `
      <article class="mobile-record-card">
        <div class="mobile-record-head"><strong><span class="color-dot" style="background:${category.color}"></span>${esc(category.name)}</strong><span>${percentage}%</span></div>
        ${category.items.length ? `<div class="mobile-budget-items">${category.items.map((item) => `<span>${esc(item.name)}<b>${formatMoney(item.plannedAmount)}</b></span>`).join("")}</div>` : '<small class="budget-item-empty">尚未設定細項</small>'}
        <div class="mobile-record-grid"><div><small>預估</small><b>${formatMoney(category.plannedAmount)}</b></div><div><small>已支出</small><b>${formatMoney(spent)}</b></div><div><small>剩餘</small><b class="${category.plannedAmount - spent < 0 ? "negative" : ""}">${formatMoney(category.plannedAmount - spent)}</b></div></div>
        <div class="mobile-record-actions"><button data-action="edit-category" data-id="${category.id}">編輯</button><button class="danger-text" data-action="delete-category" data-id="${category.id}">刪除</button></div>
      </article>`).join("") || '<div class="panel empty">還沒有分類，先新增一個預算分類吧。</div>'}</section>`, "budget");
  document.querySelectorAll<HTMLElement>("[data-sort-budget]").forEach((button) => button.addEventListener("click", () => {
    const key = button.dataset.sortBudget as BudgetSortKey;
    budgetSortDirection = key === budgetSortKey && budgetSortDirection === "asc" ? "desc" : "asc";
    budgetSortKey = key;
    renderBudget();
  }));
}

function entryFilters(entries: LedgerEntry[]) {
  return entries.filter((entry) =>
    (!query || [entry.description, entry.counterparty, entry.note].join(" ").toLowerCase().includes(query.toLowerCase())) &&
    (!filterCategory || entry.categoryId === filterCategory) &&
    (!filterStatus ||
      (filterStatus === "expense-posted" && entry.kind === "expense" && entry.status === "posted") ||
      (filterStatus === "expense-pending" && entry.kind === "expense" && entry.status === "pending") ||
      (filterStatus === "refund-posted" && entry.kind === "refund" && entry.status === "posted") ||
      (filterStatus === "refund-pending" && entry.kind === "refund" && entry.status === "pending")));
}

function mobileFilterSummary(): string {
  const labels = [
    filterCategory ? categoryName(filterCategory) : "",
    ({
      "expense-posted": "已付款",
      "expense-pending": "待付款",
      "refund-posted": "已退款",
      "refund-pending": "待退款",
    } as Record<string, string>)[filterStatus] ?? "",
  ].filter(Boolean);
  return labels.length ? `篩選 · ${labels.join("、")}` : "篩選";
}

function entryRow(entry: LedgerEntry, isFunding: boolean) {
  const source = originalExpense(entry);
  return `<tr><td>${dateLabel(entry.occurredOn)}</td><td><strong>${esc(entry.description)}</strong>${source ? `<small class="attachment-count">原支出：${esc(source.description)}</small>` : ""}${entry.attachments.length ? `<small class="attachment-count">⌁ ${entry.attachments.length} 張憑證</small>` : ""}</td><td>${esc(isFunding ? entry.counterparty : categoryName(entry.categoryId))}</td><td>${esc((isFunding ? entry.paymentMethod : entry.counterparty) || "—")}</td><td><span class="status ${entryStatusClass(entry)}">${entryStatusText(entry)}</span></td><td class="amount ${entryAmountClass(entry)}">${entryAmountSign(entry)}${formatMoney(entry.amount)}</td><td class="row-actions"><button data-action="edit-entry" data-id="${entry.id}">編輯</button><button data-action="delete-entry" data-id="${entry.id}">刪除</button></td></tr>`;
}

function entryCard(entry: LedgerEntry, isFunding: boolean) {
  const context = isFunding
    ? entry.counterparty || "未填來源"
    : `${categoryName(entry.categoryId)} · ${entry.counterparty || "未填對象"}`;
  return `<article class="mobile-record-card compact-entry-card">
    <div class="mobile-record-head"><div><small>${dateLabel(entry.occurredOn)}</small><strong>${esc(entry.description)}</strong></div><b class="amount ${entryAmountClass(entry)}">${entryAmountSign(entry)}${formatMoney(entry.amount)}</b></div>
    <div class="compact-entry-footer"><div class="compact-entry-meta"><span title="${esc(context)}">${esc(context)}</span><span class="status ${entryStatusClass(entry)}">${entryStatusText(entry)}</span></div><div class="compact-entry-actions"><button data-action="edit-entry" data-id="${entry.id}" aria-label="編輯 ${esc(entry.description)}" title="編輯">✎</button><button class="danger-text" data-action="delete-entry" data-id="${entry.id}" aria-label="刪除 ${esc(entry.description)}" title="刪除">×</button></div></div>
  </article>`;
}

function renderEntries(view: "expenses" | "funding") {
  const isFunding = view === "funding";
  const entries = entryFilters(payload!.entries.filter((entry) => isFunding ? entry.kind === "income" : entry.kind !== "income"))
    .sort((left, right) => {
      const value = (entry: LedgerEntry): string | number => {
        if (entrySortKey === "occurredOn") return entry.occurredOn;
        if (entrySortKey === "description") return entry.description;
        if (entrySortKey === "category") return isFunding ? entry.counterparty : categoryName(entry.categoryId);
        if (entrySortKey === "counterparty") return entry.counterparty;
        if (entrySortKey === "paymentMethod") return entry.paymentMethod;
        if (entrySortKey === "status") return entryStatusText(entry);
        return entry.amount;
      };
      const compare = compareSortValue(value(left), value(right));
      return entrySortDirection === "asc" ? compare : -compare;
    });
  const categoryOptions = `<option value="">全部分類</option>${payload!.categories.map((category) => `<option value="${category.id}" ${filterCategory === category.id ? "selected" : ""}>${esc(category.name)}</option>`).join("")}`;
  const statusOptions = `<option value="">全部狀態</option><option value="expense-posted" ${filterStatus === "expense-posted" ? "selected" : ""}>已付款</option><option value="expense-pending" ${filterStatus === "expense-pending" ? "selected" : ""}>待付款</option><option value="refund-posted" ${filterStatus === "refund-posted" ? "selected" : ""}>已退款</option><option value="refund-pending" ${filterStatus === "refund-pending" ? "selected" : ""}>待退款</option>`;
  layout(`
    <section class="page-actions"><p>${isFunding ? "記錄實際收到的匯款，金額會直接增加可用資金。" : "管理已付款、待付款、退款與工程憑證。"}</p><div class="entry-action-buttons">${isFunding ? "" : '<button class="secondary" data-action="new-entry" data-kind="refund">↩ 新增退貨</button>'}<button class="primary" data-action="new-entry" data-kind="${isFunding ? "income" : "expense"}">＋ 新增${isFunding ? "入帳" : "支出"}</button></div></section>
    <section class="filters panel desktop-entry-filters"><label>搜尋<input id="search" placeholder="品項、對象或備註" value="${esc(query)}" /></label>${isFunding ? "" : `<label>分類<select id="category-filter">${categoryOptions}</select></label><label>狀態<select id="status-filter">${statusOptions}</select></label>`}</section>
    <section class="mobile-entry-filters"> <div class="mobile-filter-bar"><label><span class="sr-only">搜尋</span><input id="mobile-search" placeholder="搜尋品項、對象或備註" value="${esc(query)}" /></label>${isFunding ? "" : `<button class="secondary mobile-filter-toggle" id="mobile-filter-toggle" aria-expanded="${mobileFiltersOpen}">${mobileFilterSummary()} ${mobileFiltersOpen ? "⌃" : "⌄"}</button>`}</div>${!isFunding ? `<div class="mobile-filter-options" ${mobileFiltersOpen ? "" : "hidden"}><label>分類<select id="mobile-category-filter">${categoryOptions}</select></label><label>狀態<select id="mobile-status-filter">${statusOptions}</select></label></div>` : ""}</section>
    <section class="panel table-panel desktop-table"><div class="table-wrap"><table class="entry-table"><thead><tr><th><button class="sort-button" data-sort-entry="occurredOn">日期 ${sortIndicator("occurredOn", entrySortKey, entrySortDirection)}</button></th><th><button class="sort-button" data-sort-entry="description">品項 ${sortIndicator("description", entrySortKey, entrySortDirection)}</button></th><th><button class="sort-button" data-sort-entry="category">${isFunding ? "來源" : "分類"} ${sortIndicator("category", entrySortKey, entrySortDirection)}</button></th><th><button class="sort-button" data-sort-entry="${isFunding ? "paymentMethod" : "counterparty"}">${isFunding ? "付款方式" : "對象"} ${sortIndicator(isFunding ? "paymentMethod" : "counterparty", entrySortKey, entrySortDirection)}</button></th><th><button class="sort-button" data-sort-entry="status">狀態 ${sortIndicator("status", entrySortKey, entrySortDirection)}</button></th><th><button class="sort-button" data-sort-entry="amount">金額 ${sortIndicator("amount", entrySortKey, entrySortDirection)}</button></th><th></th></tr></thead><tbody>${entries.map((entry) => entryRow(entry, isFunding)).join("") || '<tr><td colspan="7" class="empty">目前沒有符合條件的紀錄。</td></tr>'}</tbody></table></div></section>
    <section class="mobile-record-list">${entries.map((entry) => entryCard(entry, isFunding)).join("") || '<div class="panel empty">目前沒有符合條件的紀錄。</div>'}</section>`, view);
  document.querySelector<HTMLInputElement>("#search")?.addEventListener("change", (event) => {
    query = (event.target as HTMLInputElement).value;
    renderProjectPage(view);
  });
  document.querySelector<HTMLInputElement>("#mobile-search")?.addEventListener("change", (event) => {
    query = (event.target as HTMLInputElement).value;
    renderProjectPage(view);
  });
  document.querySelector<HTMLSelectElement>("#category-filter")?.addEventListener("change", (event) => {
    filterCategory = (event.target as HTMLSelectElement).value;
    renderProjectPage(view);
  });
  document.querySelector<HTMLSelectElement>("#mobile-category-filter")?.addEventListener("change", (event) => {
    filterCategory = (event.target as HTMLSelectElement).value;
    renderProjectPage(view);
  });
  document.querySelector<HTMLSelectElement>("#status-filter")?.addEventListener("change", (event) => {
    filterStatus = (event.target as HTMLSelectElement).value;
    renderProjectPage(view);
  });
  document.querySelector<HTMLSelectElement>("#mobile-status-filter")?.addEventListener("change", (event) => {
    filterStatus = (event.target as HTMLSelectElement).value;
    renderProjectPage(view);
  });
  document.querySelector<HTMLButtonElement>("#mobile-filter-toggle")?.addEventListener("click", () => {
    mobileFiltersOpen = !mobileFiltersOpen;
    renderEntries(view);
  });
  document.querySelectorAll<HTMLElement>("[data-sort-entry]").forEach((button) => button.addEventListener("click", () => {
    const key = button.dataset.sortEntry as EntrySortKey;
    entrySortDirection = key === entrySortKey && entrySortDirection === "asc" ? "desc" : "asc";
    entrySortKey = key;
    renderEntries(view);
  }));
}

/* Previous incomplete cash-flow screen retained in source history only. It is intentionally not shipped. */
/*
function renderCashflowLegacy() {
  const summaries = calculatePersonCashflows(payload!.people, payload!.entries, payload!.transfers);
  const entryFlows = payload!.entries.filter((entry) => entry.personId).map((entry) => {
    const isExpense = entry.kind === "expense";
    return { id: entry.id, source: entry.kind, occurredOn: entry.occurredOn, status: entry.status, amount: entry.amount, paymentMethod: entry.paymentMethod, note: entry.note, fromId: isExpense ? null : entry.personId, toId: isExpense ? entry.personId : null, direct: false };
  });
  const transferFlows = payload!.transfers.map((transfer) => ({
    id: transfer.id, source: "transfer", occurredOn: transfer.occurredOn, status: transfer.status, amount: transfer.amount, paymentMethod: transfer.paymentMethod, note: transfer.note, fromId: transfer.fromPersonId, toId: transfer.toPersonId, direct: true,
  }));
  const rows = [...entryFlows, ...transferFlows].filter((row) =>
    (!cashflowPersonFilter || row.fromId === cashflowPersonFilter || row.toId === cashflowPersonFilter) &&
    (!cashflowStatusFilter || row.status === cashflowStatusFilter) &&
    (!cashflowTypeFilter || row.source === cashflowTypeFilter),
  ).sort((left, right) => right.occurredOn.localeCompare(left.occurredOn));
  const tab = (id: CashflowTab, label: string) => `<button class="secondary ${cashflowTab === id ? "selected-tab" : ""}" data-cashflow-tab="${id}">${label}</button>`;
  const tabs = `<section class="cashflow-tabs">${tab("overview", "\\u6982\\u6cc1")}${tab("records", "\\u7d00\\u9304")}${tab("people", "\\u4eba\\u54e1\\u7ba1\\u7406")}</section>`;
  const personOptions = `<option value="">\\u5168\\u90e8\\u4eba\\u54e1</option>${payload!.people.map((person) => `<option value="${person.id}" ${cashflowPersonFilter === person.id ? "selected" : ""}>${esc(person.name)}</option>`).join("")}`;
  const overview = `<section class="page-actions"><p>\\u6de8\\u984d\\u70ba\\u5df2\\u6536\\u6e1b\\u5df2\\u4ed8\\uff1b\\u5f85\\u8655\\u7406\\u91d1\\u984d\\u53e6\\u5217\\u986f\\u793a\\u3002</p><button class="primary" data-action="new-transfer">? \\u65b0\\u589e\\u79fb\\u8f49</button></section>
    <section class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>\\u4eba\\u54e1</th><th>\\u5df2\\u6536</th><th>\\u5df2\\u4ed8</th><th>\\u5f85\\u6536</th><th>\\u5f85\\u4ed8</th><th>\\u6de8\\u984d</th></tr></thead><tbody>${summaries.map((summary) => `<tr><td><strong>${esc(summary.person.name)}</strong>${summary.person.role ? `<small> ${esc(summary.person.role)}</small>` : ""}${summary.person.active ? "" : ' <span class="status void">\\u5df2\\u505c\\u7528</span>'}</td><td>${formatMoney(summary.received)}</td><td>${formatMoney(summary.paid)}</td><td>${formatMoney(summary.pendingReceive)}</td><td>${formatMoney(summary.pendingPay)}</td><td class="${summary.net < 0 ? "negative" : "income"}"><strong>${summary.net >= 0 ? "\\u6de8\\u6536 " : "\\u6de8\\u4ed8 "}${formatMoney(Math.abs(summary.net))}</strong></td></tr>`).join("") || '<tr><td colspan="6" class="empty">\\u8acb\\u5148\\u65b0\\u589e\\u4eba\\u54e1</td></tr>'}</tbody></table></div></section>`;
  const records = `<section class="page-actions"><p>\\u5de5\\u7a0b\\u5e33\\u6236\\u53ca\\u4eba\\u54e1\\u9593\\u7684\\u5be6\\u969b\\u91d1\\u6d41\\u3002</p><div class="entry-action-buttons"><button class="secondary" data-action="export-cashflow">\\u4e0b\\u8f09 CSV</button><button class="primary" data-action="new-transfer">? \\u65b0\\u589e\\u79fb\\u8f49</button></div></section>
    <section class="panel desktop-entry-filters"><label>\\u4eba\\u54e1<select id="cashflow-person-filter">${personOptions}</select></label><label>\\u4f86\\u6e90<select id="cashflow-type-filter"><option value="">\\u5168\\u90e8</option><option value="income" ${cashflowTypeFilter === "income" ? "selected" : ""}>\\u5165\\u5e33</option><option value="expense" ${cashflowTypeFilter === "expense" ? "selected" : ""}>\\u652f\\u51fa</option><option value="refund" ${cashflowTypeFilter === "refund" ? "selected" : ""}>\\u9000\\u6b3e</option><option value="transfer" ${cashflowTypeFilter === "transfer" ? "selected" : ""}>\\u4eba\\u54e1\\u79fb\\u8f49</option></select></label><label>\\u72c0\\u614b<select id="cashflow-status-filter"><option value="">\\u5168\\u90e8</option><option value="posted" ${cashflowStatusFilter === "posted" ? "selected" : ""}>\\u5df2\\u5b8c\\u6210</option><option value="pending" ${cashflowStatusFilter === "pending" ? "selected" : ""}>\\u5f85\\u8655\\u7406</option><option value="void" ${cashflowStatusFilter === "void" ? "selected" : ""}>\\u5df2\\u4f5c\\u5ee2</option></select></label></section>
    <section class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>\\u65e5\\u671f</th><th>\\u4f86\\u6e90</th><th>\\u4ed8\\u6b3e\\u65b9</th><th>\\u6536\\u6b3e\\u65b9</th><th>\\u72c0\\u614b</th><th>\\u91d1\\u984d</th><th></th></tr></thead><tbody>${rows.map((row) => `<tr><td>${dateLabel(row.occurredOn)}</td><td>${row.source === "transfer" ? "\\u4eba\\u54e1\\u79fb\\u8f49" : kindLabel[row.source as EntryKind]}</td><td>${esc(row.fromId ? personName(row.fromId) : "\\u5de5\\u7a0b\\u5e33\\u6236")}</td><td>${esc(row.toId ? personName(row.toId) : "\\u5de5\\u7a0b\\u5e33\\u6236")}</td><td><span class="status ${row.status}">${row.status === "posted" ? "\\u5df2\\u5b8c\\u6210" : row.status === "pending" ? "\\u5f85\\u8655\\u7406" : "\\u5df2\\u4f5c\\u5ee2"}</span></td><td class="amount">${formatMoney(row.amount)}</td><td>${row.direct ? `<button data-action="edit-transfer" data-id="${row.id}">\\u7de8\\u8f2f</button><button data-action="delete-transfer" data-id="${row.id}">\\u522a\\u9664</button>` : '<small>\\u8acb\\u5f9e\\u6536\\u652f\\u7de8\\u8f2f</small>'}</td></tr>`).join("") || '<tr><td colspan="7" class="empty">\\u76ee\\u524d\\u6c92\\u6709\\u8cc7\\u91d1\\u6d41\\u7d00\\u9304</td></tr>'}</tbody></table></div></section>`;
  const people = `<section class="page-actions"><p>\\u4eba\\u54e1\\u540d\\u55ae\\u50c5\\u5c6c\\u65bc\\u6b64\\u5de5\\u7a0b\\u3002\\u5df2\\u88ab\\u5f15\\u7528\\u7684\\u4eba\\u54e1\\u53ef\\u505c\\u7528\\uff0c\\u4f46\\u4e0d\\u53ef\\u522a\\u9664\\u3002</p><button class="primary" data-action="new-person">? \\u65b0\\u589e\\u4eba\\u54e1</button></section>
    <section class="mobile-record-list">${payload!.people.map((person) => `<article class="mobile-record-card"><div class="mobile-record-head"><div><strong>${esc(person.name)}</strong><small>${esc(person.role || "\\u672a\\u5206\\u985e")}</small></div><span class="status ${person.active ? "posted" : "void"}">${person.active ? "\\u555f\\u7528" : "\\u5df2\\u505c\\u7528"}</span></div>${person.note ? `<p class="muted">${esc(person.note)}</p>` : ""}<div class="mobile-record-actions"><button data-action="edit-person" data-id="${person.id}">\\u7de8\\u8f2f</button><button data-action="delete-person" data-id="${person.id}">\\u522a\\u9664</button></div></article>`).join("") || '<div class="panel empty">\\u9084\\u6c92\\u6709\\u4eba\\u54e1</div>'}</section>`;
  const decodeEscapes = (value: string) => value.replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
  layout(decodeEscapes(`${tabs}${cashflowTab === "overview" ? overview : cashflowTab === "records" ? records : people}`), "cashflow");
  document.querySelectorAll<HTMLButtonElement>("[data-cashflow-tab]").forEach((button) => button.addEventListener("click", () => { cashflowTab = button.dataset.cashflowTab as CashflowTab; renderCashflow(); }));
  document.querySelector<HTMLSelectElement>("#cashflow-person-filter")?.addEventListener("change", (event) => { cashflowPersonFilter = (event.target as HTMLSelectElement).value; renderCashflow(); });
  document.querySelector<HTMLSelectElement>("#cashflow-type-filter")?.addEventListener("change", (event) => { cashflowTypeFilter = (event.target as HTMLSelectElement).value; renderCashflow(); });
  document.querySelector<HTMLSelectElement>("#cashflow-status-filter")?.addEventListener("change", (event) => { cashflowStatusFilter = (event.target as HTMLSelectElement).value; renderCashflow(); });
}

*/

function cashflowStatusLabel(status: "posted" | "pending" | "void"): string {
  return status === "posted" ? "已完成" : status === "pending" ? "待處理" : "已取消";
}

function cashflowPaymentLabel(paymentMethod: string): string {
  return ["?", "??", "???", "????", "Unspecified"].includes(paymentMethod) || !paymentMethod ? "未指定" : paymentMethod;
}

function renderCashflow() {
  const totals = calculateTotals(payload!.categories, payload!.entries);
  const summaries = calculatePersonCashflows(payload!.people, payload!.entries, payload!.transfers);
  const projectPayable = summaries.filter((summary) => summary.net > 0).reduce((sum, summary) => sum + summary.net, 0);
  const projectReceivable = summaries.filter((summary) => summary.net < 0).reduce((sum, summary) => sum + Math.abs(summary.net), 0);
  const entryFlows = payload!.entries.filter((entry) => entry.personId).map((entry) => ({
    id: entry.id,
    source: entry.kind as EntryKind | "transfer",
    occurredOn: entry.occurredOn,
    status: entry.status,
    amount: entry.amount,
    paymentMethod: entry.paymentMethod,
    note: entry.note,
    fromId: entry.kind === "expense" ? null : entry.personId,
    toId: entry.kind === "expense" ? entry.personId : null,
    direct: false,
  }));
  const transferFlows = payload!.transfers.map((transfer) => ({
    id: transfer.id,
    source: "transfer" as const,
    occurredOn: transfer.occurredOn,
    status: transfer.status,
    amount: transfer.amount,
    paymentMethod: transfer.paymentMethod,
    note: transfer.note,
    fromId: transfer.fromPersonId,
    toId: transfer.toPersonId,
    direct: true,
  }));
  const rows = [...entryFlows, ...transferFlows].filter((row) => row.status !== "void" &&
    (!cashflowPersonFilter || row.fromId === cashflowPersonFilter || row.toId === cashflowPersonFilter) &&
    (!cashflowStatusFilter || row.status === cashflowStatusFilter) &&
    (!cashflowTypeFilter || row.source === cashflowTypeFilter),
  ).sort((left, right) => right.occurredOn.localeCompare(left.occurredOn));
  const sourceLabel = (source: EntryKind | "transfer") => ({ income: "資金入帳", expense: "工程支出", refund: "退款入帳", transfer: "資金移轉" })[source];
  const accountOrPerson = (personId: string | null) => personId ? personName(personId) : "工程帳戶";
  const tab = (id: CashflowTab, label: string) => `<button class="secondary ${cashflowTab === id ? "selected-tab" : ""}" data-cashflow-tab="${id}">${label}</button>`;
  const tabs = `<section class="cashflow-tabs">${tab("overview", "總覽")}${tab("records", "資金明細")}${tab("people", "人員管理")}</section>`;
  const personOptions = `<option value="">全部人員</option>${payload!.people.map((person) => `<option value="${person.id}" ${cashflowPersonFilter === person.id ? "selected" : ""}>${esc(person.name)}</option>`).join("")}`;
  const overview = `
    <section class="cashflow-intro">
      <div><p class="eyebrow">PROJECT CASH FLOW</p><h3>工程帳戶與人員往來</h3><p>正數代表工程尚應付給該人員；負數代表該人員尚應付回工程。待處理款項不會計入餘額。</p></div>
      <button class="primary" data-action="new-transfer">↔ 新增資金移轉</button>
    </section>
    <section class="cashflow-summary-cards">
      <article><small>工程帳戶餘額</small><strong class="${totals.cashBalance < 0 ? "negative" : ""}">${formatMoney(totals.cashBalance)}</strong><span>已入帳 ${formatMoney(totals.received)} · 已支出 ${formatMoney(totals.spent)}</span></article>
      <article><small>工程應付人員</small><strong>${formatMoney(projectPayable)}</strong><span>人員已收款多於已付款</span></article>
      <article><small>工程應收人員</small><strong>${formatMoney(projectReceivable)}</strong><span>人員已付款多於已收款</span></article>
    </section>
    <section class="panel table-panel desktop-table"><div class="table-wrap"><table><thead><tr><th>人員</th><th>已收款</th><th>已付款</th><th>待收款</th><th>待付款</th><th>與工程往來餘額</th><th></th></tr></thead><tbody>${summaries.map((summary) => {
      const label = summary.net >= 0 ? "工程應付" : "工程應收";
      return `<tr><td><strong>${esc(summary.person.name)}</strong>${summary.person.role ? `<small class="cashflow-role">${esc(summary.person.role)}</small>` : ""}${summary.person.active ? "" : ' <span class="status void">已停用</span>'}</td><td>${formatMoney(summary.received)}</td><td>${formatMoney(summary.paid)}</td><td>${formatMoney(summary.pendingReceive)}</td><td>${formatMoney(summary.pendingPay)}</td><td class="${summary.net < 0 ? "negative" : "income"}"><strong>${label} ${formatMoney(Math.abs(summary.net))}</strong></td><td class="row-actions"><button data-action="edit-person-cashflow" data-id="${summary.person.id}">編輯金流</button></td></tr>`;
    }).join("") || '<tr><td colspan="7" class="empty">尚未建立人員，請先到「人員管理」新增。</td></tr>'}</tbody></table></div></section>
    <section class="mobile-record-list">${summaries.map((summary) => {
      const label = summary.net >= 0 ? "工程應付" : "工程應收";
      return `<article class="mobile-record-card cashflow-summary-card"><div class="mobile-record-head"><div><strong>${esc(summary.person.name)}</strong><small>${esc(summary.person.role || "未填職稱")}</small></div><b class="${summary.net < 0 ? "negative" : "income"}">${label} ${formatMoney(Math.abs(summary.net))}</b></div><div class="cashflow-mini-values"><span>已收 ${formatMoney(summary.received)}</span><span>已付 ${formatMoney(summary.paid)}</span><span>待收 ${formatMoney(summary.pendingReceive)}</span><span>待付 ${formatMoney(summary.pendingPay)}</span></div><div class="mobile-record-actions"><button data-action="edit-person-cashflow" data-id="${summary.person.id}">編輯金流</button></div></article>`;
    }).join("") || '<div class="panel empty">尚未建立人員，請先到「人員管理」新增。</div>'}</section>`;
  const records = `
    <section class="page-actions"><p>可直接編輯收入、支出、退款與資金移轉；異動後會同步更新工程與人員餘額。</p><div class="entry-action-buttons"><button class="secondary" data-action="export-cashflow">下載 CSV</button><button class="primary" data-action="new-transfer">↔ 新增資金移轉</button></div></section>
    <section class="panel cashflow-filters"><label>人員<select id="cashflow-person-filter">${personOptions}</select></label><label>類型<select id="cashflow-type-filter"><option value="">全部類型</option><option value="income" ${cashflowTypeFilter === "income" ? "selected" : ""}>資金入帳</option><option value="expense" ${cashflowTypeFilter === "expense" ? "selected" : ""}>工程支出</option><option value="refund" ${cashflowTypeFilter === "refund" ? "selected" : ""}>退款入帳</option><option value="transfer" ${cashflowTypeFilter === "transfer" ? "selected" : ""}>資金移轉</option></select></label><label>狀態<select id="cashflow-status-filter"><option value="">全部狀態</option><option value="posted" ${cashflowStatusFilter === "posted" ? "selected" : ""}>已完成</option><option value="pending" ${cashflowStatusFilter === "pending" ? "selected" : ""}>待處理</option></select></label></section>
    <section class="panel table-panel desktop-table"><div class="table-wrap"><table><thead><tr><th>日期</th><th>類型</th><th>出款方</th><th>收款方</th><th>付款方式</th><th>狀態</th><th>金額</th><th></th></tr></thead><tbody>${rows.map((row) => `<tr><td>${dateLabel(row.occurredOn)}</td><td>${sourceLabel(row.source)}</td><td>${esc(accountOrPerson(row.fromId))}</td><td>${esc(accountOrPerson(row.toId))}</td><td>${esc(cashflowPaymentLabel(row.paymentMethod))}</td><td><span class="status ${row.status}">${cashflowStatusLabel(row.status)}</span></td><td class="amount">${formatMoney(row.amount)}</td><td class="row-actions">${row.direct ? `<button data-action="edit-transfer" data-id="${row.id}">編輯</button><button data-action="delete-transfer" data-id="${row.id}">刪除</button>` : `<button data-action="edit-entry" data-id="${row.id}">編輯</button><button data-action="delete-entry" data-id="${row.id}">刪除</button>`}</td></tr>`).join("") || '<tr><td colspan="8" class="empty">目前沒有符合條件的資金流紀錄。</td></tr>'}</tbody></table></div></section>
    <section class="mobile-record-list">${rows.map((row) => `<article class="mobile-record-card compact-entry-card"><div class="mobile-record-head"><div><small>${dateLabel(row.occurredOn)} · ${sourceLabel(row.source)}</small><strong>${esc(accountOrPerson(row.fromId))} → ${esc(accountOrPerson(row.toId))}</strong></div><b class="amount">${formatMoney(row.amount)}</b></div><div class="compact-entry-footer"><div class="compact-entry-meta"><span>${esc(cashflowPaymentLabel(row.paymentMethod))}</span><span class="status ${row.status}">${cashflowStatusLabel(row.status)}</span></div>${row.direct ? `<div class="compact-entry-actions"><button aria-label="編輯移轉" data-action="edit-transfer" data-id="${row.id}">✎</button><button class="danger-text" aria-label="刪除移轉" data-action="delete-transfer" data-id="${row.id}">×</button></div>` : `<div class="compact-entry-actions"><button aria-label="編輯金流" data-action="edit-entry" data-id="${row.id}">✎</button><button class="danger-text" aria-label="刪除金流" data-action="delete-entry" data-id="${row.id}">×</button></div>`}</div></article>`).join("") || '<div class="panel empty">目前沒有符合條件的資金流紀錄。</div>'}</section>`;
  const people = `
    <section class="page-actions"><p>人員名單僅屬於這個工程。已有往來紀錄的人員可停用，但不能直接刪除。</p><button class="primary" data-action="new-person">＋ 新增人員</button></section>
    <section class="people-grid">${payload!.people.map((person) => `<article class="mobile-record-card"><div class="mobile-record-head"><div><strong>${esc(person.name)}</strong><small>${esc(person.role || "未填職稱")}</small></div><span class="status ${person.active ? "posted" : "void"}">${person.active ? "啟用中" : "已停用"}</span></div>${person.note ? `<p class="muted">${esc(person.note)}</p>` : ""}<div class="mobile-record-actions"><button data-action="edit-person" data-id="${person.id}">編輯</button><button class="danger-text" data-action="delete-person" data-id="${person.id}">刪除</button></div></article>`).join("") || '<div class="panel empty">尚未建立人員。</div>'}</section>`;
  layout(`${tabs}${cashflowTab === "overview" ? overview : cashflowTab === "records" ? records : people}`, "cashflow");
  document.querySelectorAll<HTMLButtonElement>("[data-cashflow-tab]").forEach((button) => button.addEventListener("click", () => {
    cashflowTab = button.dataset.cashflowTab as CashflowTab;
    renderCashflow();
  }));
  document.querySelector<HTMLSelectElement>("#cashflow-person-filter")?.addEventListener("change", (event) => {
    cashflowPersonFilter = (event.target as HTMLSelectElement).value;
    renderCashflow();
  });
  document.querySelector<HTMLSelectElement>("#cashflow-type-filter")?.addEventListener("change", (event) => {
    cashflowTypeFilter = (event.target as HTMLSelectElement).value;
    renderCashflow();
  });
  document.querySelector<HTMLSelectElement>("#cashflow-status-filter")?.addEventListener("change", (event) => {
    cashflowStatusFilter = (event.target as HTMLSelectElement).value;
    renderCashflow();
  });
}

function renderSettings() {
  const project = payload!.project;
  layout(`
    <section class="settings-grid">
      <article class="panel setting-card"><p class="eyebrow">PROJECT</p><h3>${esc(project.name)}</h3><p class="muted">${project.address ? esc(project.address) : "尚未填寫地址"}<br>${projectStatusLabel[project.status]} · 最後更新 ${new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short" }).format(new Date(project.updatedAt))}</p><button class="secondary" data-action="edit-project">編輯工程資料</button></article>
      <article class="panel setting-card"><p class="eyebrow">EXPORT</p><h3>下載帳務紀錄</h3><p class="muted">CSV 可直接使用 Excel 或 Google 試算表開啟。</p><button class="secondary" data-action="export-project">下載 CSV</button></article>
      <article class="panel setting-card danger-zone"><p class="eyebrow">ARCHIVE</p><h3>${project.status === "archived" ? "重新啟用工程" : "封存工程案"}</h3><p class="muted">封存不會刪除帳務或照片，之後仍可重新啟用。</p><button class="secondary ${project.status === "archived" ? "" : "danger"}" data-action="${project.status === "archived" ? "restore-current-project" : "archive-current-project"}">${project.status === "archived" ? "重新啟用" : "封存工程"}</button></article>
    </section>`, "settings");
}

function renderProjectPage(view: ProjectView) {
  if (!payload) return;
  if (view === "dashboard") renderDashboard();
  else if (view === "budget") renderBudget();
  else if (view === "cashflow") renderCashflow();
  else if (view === "expenses" || view === "funding") renderEntries(view);
  else renderSettings();
}

function openModal(content: string) {
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${content}</div>`;
  modal.addEventListener("click", (event) => {
    if (event.target === modal || (event.target as HTMLElement).closest("[data-action='close-modal']")) modal.remove();
  });
  document.body.append(modal);
}

function openProjectModal(existing?: Project) {
  openModal(`
    <div class="modal-head"><div><p class="eyebrow">PROJECT</p><h3>${existing ? "編輯工程案" : "建立工程案"}</h3></div><button class="icon-button" data-action="close-modal">×</button></div>
    <form id="project-form" class="form-grid">
      <label class="full">工程案名稱<input name="name" maxlength="60" required value="${esc(existing?.name ?? "")}" placeholder="例如：中山路店面水電工程" autofocus /></label>
      <label class="full">工程地址<input name="address" maxlength="160" value="${esc(existing?.address ?? "")}" placeholder="例如：台北市中山區…" /></label>
      <label>工程狀態<select name="status"><option value="active" ${existing?.status === "active" || !existing ? "selected" : ""}>進行中</option><option value="completed" ${existing?.status === "completed" ? "selected" : ""}>已完工</option><option value="archived" ${existing?.status === "archived" ? "selected" : ""}>已封存</option></select></label>
      <div class="form-submit"><button type="button" class="secondary" data-action="close-modal">取消</button><button class="primary" type="submit">${existing ? "儲存工程" : "建立工程"}</button></div>
    </form>`);
  document.querySelector<HTMLFormElement>("#project-form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const input = {
      name: String(form.get("name")).trim(),
      address: String(form.get("address")).trim(),
      status: String(form.get("status")) as ProjectStatus,
    };
    try {
      const project = existing ? await updateProject(existing.id, input) : await createProject(input);
      document.querySelector(".modal-backdrop")?.remove();
      toast(existing ? "工程資料已更新" : "工程案已建立");
      if (existing) await refresh();
      else location.hash = projectRoute(project.id);
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "儲存失敗", "error");
    }
  });
}

function openCategoryModal(existing?: Category) {
  openModal(`
    <div class="modal-head"><div><p class="eyebrow">BUDGET CATEGORY</p><h3>${existing ? "編輯分類" : "新增分類"}</h3></div><button class="icon-button" data-action="close-modal">×</button></div>
    <form id="category-form" class="form-grid">
      <label>分類名稱<input name="name" maxlength="30" required value="${esc(existing?.name ?? "")}" placeholder="例如：配電工程" /></label>
      <label>分類總預算<input name="plannedAmount" type="number" min="0" step="1" required value="${existing?.plannedAmount ?? ""}" placeholder="0" /></label>
      <label>識別顏色<input name="color" type="color" value="${existing?.color ?? "#1d6f63"}" /></label>
      <section class="budget-detail-editor full">
        <div class="budget-detail-head"><div><strong>預算細項</strong><small>新增細項後，分類總預算會自動加總。</small></div><button class="secondary small-button" type="button" data-action="add-budget-item">＋ 新增細項</button></div>
        <div class="budget-detail-rows"></div>
        <p class="form-hint budget-detail-total">尚未新增細項，可直接填寫分類總預算。</p>
      </section>
      <div class="form-submit"><button type="button" class="secondary" data-action="close-modal">取消</button><button class="primary" type="submit">儲存分類</button></div>
    </form>`);
  const formElement = document.querySelector<HTMLFormElement>("#category-form")!;
  const detailRows = formElement.querySelector<HTMLElement>(".budget-detail-rows")!;
  const plannedInput = formElement.elements.namedItem("plannedAmount") as HTMLInputElement;
  const detailTotal = formElement.querySelector<HTMLElement>(".budget-detail-total")!;
  const itemRow = (name = "", plannedAmount = "") => `<div class="budget-detail-row">
    <input name="itemName" maxlength="60" value="${esc(name)}" placeholder="細項名稱，例如：木工（隔間）" />
    <input name="itemAmount" type="number" min="0" step="1" value="${plannedAmount}" placeholder="金額" />
    <button class="icon-button detail-remove" type="button" aria-label="移除細項" data-action="remove-budget-item">×</button>
  </div>`;
  const syncDetails = () => {
    const rows = [...detailRows.querySelectorAll<HTMLElement>(".budget-detail-row")];
    const total = rows.reduce((sum, row) => sum + Math.max(0, Number((row.querySelector("[name='itemAmount']") as HTMLInputElement).value) || 0), 0);
    const hasDetails = rows.length > 0;
    plannedInput.readOnly = hasDetails;
    plannedInput.required = !hasDetails;
    plannedInput.value = hasDetails ? String(total) : (existing?.plannedAmount ? String(existing.plannedAmount) : "");
    detailTotal.textContent = hasDetails
      ? `細項合計：${formatMoney(total)}（分類總預算已自動帶入）`
      : "尚未新增細項，可直接填寫分類總預算。";
  };
  const addDetail = (name = "", plannedAmount = "") => {
    detailRows.insertAdjacentHTML("beforeend", itemRow(name, plannedAmount));
    syncDetails();
  };
  existing?.items.forEach((item) => addDetail(item.name, String(item.plannedAmount)));
  formElement.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-action]");
    if (!button) return;
    if (button.dataset.action === "add-budget-item") addDetail();
    if (button.dataset.action === "remove-budget-item") {
      button.closest(".budget-detail-row")?.remove();
      syncDetails();
    }
  });
  detailRows.addEventListener("input", syncDetails);
  syncDetails();
  formElement.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(formElement);
    const items = [...detailRows.querySelectorAll<HTMLElement>(".budget-detail-row")]
      .map((row) => ({
        name: (row.querySelector("[name='itemName']") as HTMLInputElement).value.trim(),
        plannedAmount: Number((row.querySelector("[name='itemAmount']") as HTMLInputElement).value),
      }));
    if (items.some((item) => !item.name || !Number.isSafeInteger(item.plannedAmount) || item.plannedAmount < 0)) {
      return toast("每筆細項都需要名稱與非負整數金額。", "error");
    }
    try {
      await saveCategory(currentProjectId(), {
        name: String(form.get("name")).trim(),
        plannedAmount: Number(form.get("plannedAmount")),
        color: String(form.get("color")),
        items,
      }, existing?.id);
      document.querySelector(".modal-backdrop")?.remove();
      await refresh();
      toast("分類已儲存");
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "儲存失敗", "error");
    }
  });
}

function openEntryModal(existing?: LedgerEntry, defaultKind: EntryKind = "expense") {
  const kind = existing?.kind ?? defaultKind;
  const categoryOptions = `<option value="">不指定分類</option>${payload!.categories.map((category) => `<option value="${category.id}" ${(existing?.categoryId ?? "") === category.id ? "selected" : ""}>${esc(category.name)}</option>`).join("")}`;
  const refundSources = payload!.entries.filter((entry) =>
    entry.kind === "expense" && entry.status === "posted" && (entry.id === existing?.refundOfEntryId || refundReserved(entry.id, existing?.id) < entry.amount));
  const refundSourceOptions = `<option value="">選擇已付款的原始支出</option>${refundSources.map((entry) => {
    const remaining = entry.amount - refundReserved(entry.id, existing?.id);
    return `<option value="${entry.id}" ${entry.id === existing?.refundOfEntryId ? "selected" : ""}>${esc(entry.description)}（可退 ${formatMoney(remaining)}）</option>`;
  }).join("")}`;
  openModal(`
    <div class="modal-head"><div><p class="eyebrow">${kindLabel[kind]}</p><h3>${existing ? "編輯紀錄" : `新增${kindLabel[kind]}`}</h3></div><button class="icon-button" data-action="close-modal">×</button></div>
    <form id="entry-form" class="form-grid">
      <label>紀錄類型<input value="${kindLabel[kind]}" readonly aria-readonly="true" /></label><input name="kind" type="hidden" value="${kind}" />
      <label>品項／用途<input name="description" maxlength="80" required value="${esc(existing?.description ?? "")}" placeholder="例如：一樓配電材料" /></label>
      <label>金額<input name="amount" type="number" min="1" step="1" required value="${existing?.amount ?? ""}" /></label>
      <label>日期<input name="occurredOn" type="date" required value="${existing?.occurredOn ?? new Date().toISOString().slice(0, 10)}" /></label>
      <label class="full refund-source-field">原始支出<select name="refundOfEntryId">${refundSourceOptions}</select></label>
      <label>預算分類<select name="categoryId">${categoryOptions}</select></label>
      <label>\u4eba\u54e1<select name="personId" required>${activePersonOptions(existing?.personId ?? null)}</select></label>
      <label>對象<input name="counterparty" maxlength="60" value="${esc(existing?.counterparty ?? "")}" placeholder="廠商或匯款人" /></label>
      <label>付款方式<select name="paymentMethod"><option value="">未指定</option>${["銀行轉帳", "現金", "信用卡", "電子支付"].map((method) => `<option ${existing?.paymentMethod === method ? "selected" : ""}>${method}</option>`).join("")}</select></label>
      <label>狀態<select name="status"></select></label>
      <p class="form-hint full"></p>
      <label class="full">備註<textarea name="note" maxlength="500" placeholder="保固、報價或付款說明">${esc(existing?.note ?? "")}</textarea></label>
      <label class="full upload-field">憑證照片（JPG、PNG、WebP；最多 5 張，每張 10MB）<input name="files" type="file" accept="image/jpeg,image/png,image/webp" multiple /></label>
      <div class="form-submit"><button type="button" class="secondary" data-action="close-modal">取消</button><button class="primary" type="submit">儲存紀錄</button></div>
    </form>`);
  const formElement = document.querySelector<HTMLFormElement>("#entry-form")!;
  const kindInput = formElement.elements.namedItem("kind") as HTMLInputElement;
  const statusInput = formElement.elements.namedItem("status") as HTMLSelectElement;
  const sourceInput = formElement.elements.namedItem("refundOfEntryId") as HTMLSelectElement;
  const categoryInput = formElement.elements.namedItem("categoryId") as HTMLSelectElement;
  const amountInput = formElement.elements.namedItem("amount") as HTMLInputElement;
  const descriptionInput = formElement.elements.namedItem("description") as HTMLInputElement;
  const counterpartyInput = formElement.elements.namedItem("counterparty") as HTMLInputElement;
  const personInput = formElement.elements.namedItem("personId") as HTMLSelectElement;
  const paymentInput = formElement.elements.namedItem("paymentMethod") as HTMLSelectElement;
  const sourceField = formElement.querySelector<HTMLElement>(".refund-source-field")!;
  const hint = formElement.querySelector<HTMLElement>(".form-hint")!;
  const statusOptions = (selected: string) => kindInput.value === "income"
    ? `<option value="posted" selected>已入帳</option>`
    : kindInput.value === "refund"
      ? `<option value="posted" ${selected === "posted" ? "selected" : ""}>已退款</option><option value="pending" ${selected === "pending" ? "selected" : ""}>待退款</option>`
      : `<option value="posted" ${selected === "posted" ? "selected" : ""}>已付款</option><option value="pending" ${selected === "pending" ? "selected" : ""}>待付款</option>`;
  const applySource = () => {
    const source = payload!.entries.find((entry) => entry.id === sourceInput.value);
    if (!source) return;
    descriptionInput.value = `退貨：${source.description}`;
    categoryInput.value = source.categoryId ?? "";
    personInput.value = source.personId ?? "";
    counterpartyInput.value = source.counterparty;
    paymentInput.value = source.paymentMethod;
    amountInput.max = String(source.amount - refundReserved(source.id, existing?.id));
  };
  const sync = () => {
    const selected = statusInput.value || (existing?.status === "pending" ? "pending" : "posted");
    statusInput.innerHTML = statusOptions(selected);
    const isRefundKind = kindInput.value === "refund";
    sourceField.hidden = !isRefundKind;
    sourceInput.disabled = !isRefundKind;
    personInput.disabled = isRefundKind;
    sourceInput.required = isRefundKind;
    categoryInput.disabled = isRefundKind;
    hint.textContent = isRefundKind
      ? "退款必須連結原始已付款支出；只有選擇「已退款」後，金額才會加回可用資金與預算餘額。"
      : kindInput.value === "income"
        ? "已入帳的資金會直接增加可用資金。"
        : "支出只可記錄已付款或待付款；退貨請另建一筆退款紀錄。";
    if (isRefundKind && sourceInput.value) applySource();
    if (!isRefundKind) amountInput.removeAttribute("max");
  };
  sourceInput.addEventListener("change", applySource);
  sync();
  formElement.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(formElement);
    const files = [...(formElement.querySelector<HTMLInputElement>("[name='files']")?.files ?? [])];
    if (files.length + (existing?.attachments.length ?? 0) > 5 ||
      files.some((file) => file.size > 10 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type))) {
      return toast("每筆最多 5 張 JPG、PNG、WebP，且每張不得超過 10MB。", "error");
    }
    try {
      const projectId = currentProjectId();
      const selectedPerson = personById(String(form.get("personId")) || null);
      const result = await saveEntry(projectId, {
        kind: String(form.get("kind")) as EntryKind,
        status: String(form.get("status")) as LedgerEntry["status"],
        refundOfEntryId: form.get("refundOfEntryId")?.toString() || null,
        personId: String(form.get("personId")) || null,
        counterparty: selectedPerson?.name ?? String(form.get("counterparty")).trim(),
        description: String(form.get("description")).trim(),
        amount: Number(form.get("amount")),
        occurredOn: String(form.get("occurredOn")),
        categoryId: String(form.get("categoryId")) || null,
        paymentMethod: String(form.get("paymentMethod")),
        note: String(form.get("note")).trim(),
      }, existing?.id);
      await uploadAttachments(projectId, result.id, files);
      document.querySelector(".modal-backdrop")?.remove();
      await refresh();
      toast("紀錄已儲存");
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "儲存失敗", "error");
    }
  });
}

function openPersonModal(existing?: Person) {
  openModal(`
    <div class="modal-head"><div><p class="eyebrow">PROJECT CONTACT</p><h3>${existing ? "編輯人員" : "新增人員"}</h3></div><button class="icon-button" aria-label="關閉" data-action="close-modal">×</button></div>
    <form id="person-form" class="form-grid">
      <label>姓名／名稱<input name="name" maxlength="60" required value="${esc(existing?.name ?? "")}" placeholder="例如：Danny" autofocus /></label>
      <label>身分／職稱<input name="role" maxlength="40" value="${esc(existing?.role ?? "")}" placeholder="例如：屋主、木工、水電工" /></label>
      <label class="full">備註<textarea name="note" maxlength="500" placeholder="可記錄聯絡方式、合作內容等">${esc(existing?.note ?? "")}</textarea></label>
      <label class="person-active-toggle"><input name="active" type="checkbox" ${existing?.active === false ? "" : "checked"} /> 啟用此人員</label>
      <div class="form-submit"><button type="button" class="secondary" data-action="close-modal">取消</button><button class="primary" type="submit">儲存人員</button></div>
    </form>`);
  document.querySelector<HTMLFormElement>("#person-form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    try {
      await savePerson(currentProjectId(), { name: String(form.get("name")).trim(), role: String(form.get("role")).trim(), note: String(form.get("note")).trim(), active: form.get("active") === "on" }, existing?.id);
      document.querySelector(".modal-backdrop")?.remove();
      await refresh();
      toast("人員已儲存");
    } catch (reason) { toast(reason instanceof Error ? reason.message : "儲存失敗", "error"); }
  });
}

function openTransferModal(existing?: FundTransfer) {
  const active = payload!.people.filter((person) => person.active || person.id === existing?.fromPersonId || person.id === existing?.toPersonId);
  const optionList = (selected: string | undefined) => `<option value="">請選擇人員</option>${active.map((person) => `<option value="${person.id}" ${person.id === selected ? "selected" : ""}>${esc(person.name)}${person.role ? `（${esc(person.role)}）` : ""}</option>`).join("")}`;
  openModal(`
    <div class="modal-head"><div><p class="eyebrow">FUND TRANSFER</p><h3>${existing ? "編輯資金移轉" : "新增資金移轉"}</h3></div><button class="icon-button" aria-label="關閉" data-action="close-modal">×</button></div>
    <form id="transfer-form" class="form-grid">
      <label>出款人<select name="fromPersonId" required>${optionList(existing?.fromPersonId)}</select></label>
      <label>收款人<select name="toPersonId" required>${optionList(existing?.toPersonId)}</select></label>
      <label>金額<input name="amount" type="number" min="1" step="1" required value="${existing?.amount ?? ""}" /></label>
      <label>日期<input name="occurredOn" type="date" required value="${existing?.occurredOn ?? new Date().toISOString().slice(0, 10)}" /></label>
      <label>付款方式<select name="paymentMethod"><option value="">未指定</option>${["銀行轉帳", "現金", "信用卡", "電子支付"].map((method) => `<option ${existing?.paymentMethod === method ? "selected" : ""}>${method}</option>`).join("")}</select></label>
      <label>狀態<select name="status"><option value="posted" ${existing?.status !== "pending" ? "selected" : ""}>已完成</option><option value="pending" ${existing?.status === "pending" ? "selected" : ""}>待處理</option></select></label>
      <p class="form-hint full">僅記錄人員之間的移轉；工程收入、支出與退款請從各自的收支頁建立。</p>
      <label class="full">備註<textarea name="note" maxlength="500" placeholder="例如：代墊材料款結算">${esc(existing?.note ?? "")}</textarea></label>
      <div class="form-submit"><button type="button" class="secondary" data-action="close-modal">取消</button><button class="primary" type="submit">儲存移轉</button></div>
    </form>`);
  document.querySelector<HTMLFormElement>("#transfer-form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    try {
      await saveTransfer(currentProjectId(), { fromPersonId: String(form.get("fromPersonId")), toPersonId: String(form.get("toPersonId")), amount: Number(form.get("amount")), occurredOn: String(form.get("occurredOn")), status: String(form.get("status")) as FundTransfer["status"], paymentMethod: String(form.get("paymentMethod")), note: String(form.get("note")).trim() }, existing?.id);
      document.querySelector(".modal-backdrop")?.remove();
      await refresh();
      toast("資金移轉已儲存");
    } catch (reason) { toast(reason instanceof Error ? reason.message : "儲存失敗", "error"); }
  });
}

function bindCommon() {
  document.querySelectorAll<HTMLElement>("[data-action]").forEach((button) => button.addEventListener("click", async () => {
    const action = button.dataset.action;
    if (action === "logout") {
      session.token = null;
      payload = null;
      projects = [];
      showLogin();
    }
    if (action === "refresh") {
      await refresh();
      toast("資料已更新");
    }
    if (action === "new-project") openProjectModal();
    if (action === "edit-project") openProjectModal(payload!.project);
    if (action === "archive-project" || action === "restore-project") {
      const archived = action === "archive-project";
      if (!archived || confirm("封存後仍可查看並重新啟用，確定封存嗎？")) {
        try {
          await setProjectArchived(button.dataset.id!, archived);
          await refresh();
          toast(archived ? "工程已封存" : "工程已重新啟用");
        } catch (reason) {
          toast(reason instanceof Error ? reason.message : "操作失敗", "error");
        }
      }
    }
    if (action === "archive-current-project" || action === "restore-current-project") {
      const archived = action === "archive-current-project";
      if (!archived || confirm("封存不會刪除資料，確定封存此工程嗎？")) {
        await setProjectArchived(currentProjectId(), archived);
        location.hash = projectsRoute();
      }
    }
    if (action === "export-project") {
      try {
        await downloadProjectCsv(currentProjectId(), payload!.project.name);
      } catch (reason) {
        toast(reason instanceof Error ? reason.message : "下載失敗", "error");
      }
    }
    if (action === "new-category") openCategoryModal();
    if (action === "edit-category") openCategoryModal(payload!.categories.find((category) => category.id === button.dataset.id));
    if (action === "delete-category" && confirm("確定刪除此分類嗎？已被支出使用的分類不能直接刪除。")) {
      try {
        await deleteCategory(currentProjectId(), button.dataset.id!);
        await refresh();
        toast("分類已刪除");
      } catch (reason) {
        toast(reason instanceof Error ? reason.message : "刪除失敗", "error");
      }
    }
    if (action === "new-entry") openEntryModal(undefined, button.dataset.kind as EntryKind);
    if (action === "edit-entry") openEntryModal(payload!.entries.find((entry) => entry.id === button.dataset.id));
    if (action === "delete-entry" && confirm("確定刪除此筆紀錄與其附件嗎？")) {
      try {
        await deleteEntry(currentProjectId(), button.dataset.id!);
        await refresh();
        toast("紀錄已刪除");
      } catch (reason) {
        toast(reason instanceof Error ? reason.message : "刪除失敗", "error");
      }
    }
    if (action === "export-cashflow") {
      try { await downloadCashflowCsv(currentProjectId(), payload!.project.name); }
      catch (reason) { toast(reason instanceof Error ? reason.message : "下載失敗", "error"); }
    }
    if (action === "edit-person-cashflow") {
      cashflowPersonFilter = button.dataset.id ?? "";
      cashflowTypeFilter = "";
      cashflowStatusFilter = "";
      cashflowTab = "records";
      renderCashflow();
    }
    if (action === "new-person") openPersonModal();
    if (action === "edit-person") openPersonModal(payload!.people.find((person) => person.id === button.dataset.id));
    if (action === "delete-person" && confirm("確定刪除此人員嗎？已有往來紀錄的人員請改為停用。")) {
      try { await deletePerson(currentProjectId(), button.dataset.id!); await refresh(); toast("人員已刪除"); }
      catch (reason) { toast(reason instanceof Error ? reason.message : "刪除失敗", "error"); }
    }
    if (action === "new-transfer") openTransferModal();
    if (action === "edit-transfer") openTransferModal(payload!.transfers.find((transfer) => transfer.id === button.dataset.id));
    if (action === "delete-transfer" && confirm("確定刪除這筆資金移轉嗎？")) {
      try { await deleteTransfer(currentProjectId(), button.dataset.id!); await refresh(); toast("資金移轉已刪除"); }
      catch (reason) { toast(reason instanceof Error ? reason.message : "刪除失敗", "error"); }
    }
  }));
}

window.addEventListener("hashchange", () => {
  query = "";
  filterCategory = "";
  filterStatus = "";
  refresh();
});

if (!location.hash) history.replaceState(null, "", projectsRoute());
if (session.token) refresh();
else showLogin();
