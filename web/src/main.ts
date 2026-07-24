import "./style.css";
import {
  ApiError,
  createProject,
  deleteCategory,
  deleteEntry,
  downloadProjectCsv,
  isDemoMode,
  loadDashboard,
  loadProjects,
  login,
  saveCategory,
  saveEntry,
  session,
  setProjectArchived,
  updateProject,
  uploadAttachments,
} from "./api";
import { calculateTotals, categorySpent, formatMoney } from "./finance";
import { parseRoute, projectRoute, projectsRoute, type ProjectView } from "./router";
import type {
  Category,
  DashboardPayload,
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
let loading = false;
type SortDirection = "asc" | "desc";
type BudgetSortKey = "sortOrder" | "name" | "planned" | "spent" | "remaining" | "percentage";
type EntrySortKey = "occurredOn" | "description" | "category" | "paymentMethod" | "status" | "amount";
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
const statusLabel: Record<LedgerEntry["status"], string> = {
  posted: "已入帳",
  pending: "待付款",
  refunded: "已退款",
  void: "已作廢",
};
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

function isReturned(entry: LedgerEntry): boolean {
  return entry.kind === "refund" || (entry.kind === "expense" && entry.status === "refunded");
}

function entryAmountSign(entry: LedgerEntry): string {
  return entry.kind === "income" || isReturned(entry) ? "+" : "−";
}

function entryAmountClass(entry: LedgerEntry): string {
  if (entry.kind === "income") return "income";
  if (isReturned(entry)) return "returned";
  return "";
}

function entryStatusText(entry: LedgerEntry): string {
  return entry.kind === "refund" ? "退款" : statusLabel[entry.status];
}

function entryStatusClass(entry: LedgerEntry): string {
  return isReturned(entry) ? "refunded" : entry.status;
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
  layout(`
    <section class="hero-grid">
      <article class="balance-card"><div><p>可用資金</p><h3>${formatMoney(totals.cashBalance)}</h3><span>${totals.received ? `已入帳 ${formatMoney(totals.received)}` : "等待第一筆入帳"}</span></div><div class="balance-orb">NT$</div></article>
      <article class="metric-card"><p>預估總預算</p><h3>${formatMoney(totals.planned)}</h3><span>已使用 ${usage}%</span></article>
      <article class="metric-card"><p>實際支出</p><h3>${formatMoney(totals.spent)}</h3><span class="${totals.returned ? "returned" : "negative"}">${totals.returned ? `已退回 +${formatMoney(totals.returned)}` : `待付款 ${formatMoney(totals.pending)}`}</span></article>
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
          <div class="activity"><div class="entry-icon ${isReturned(entry) ? "refund" : entry.kind}">${entry.kind === "income" ? "↓" : isReturned(entry) ? "↩" : "↑"}</div><div><strong>${esc(entry.description)}</strong><small>${dateLabel(entry.occurredOn)} · ${isReturned(entry) ? "已退款" : esc(kindLabel[entry.kind])}</small></div><b class="${entryAmountClass(entry)}">${entryAmountSign(entry)}${formatMoney(entry.amount)}</b></div>`).join("") || '<p class="empty">尚無帳務紀錄</p>'}</div>
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
      ${rows.map(({ category, spent, percentage }) => `<tr><td><span class="color-dot" style="background:${category.color}"></span>${esc(category.name)}</td><td>${formatMoney(category.plannedAmount)}</td><td>${formatMoney(spent)}</td><td class="${category.plannedAmount - spent < 0 ? "negative" : ""}">${formatMoney(category.plannedAmount - spent)}</td><td><div class="percentage"><i style="width:${Math.min(100, Math.max(0, percentage))}%;background:${category.color}"></i><span>${percentage}%</span></div></td><td class="row-actions"><button data-action="edit-category" data-id="${category.id}">編輯</button><button data-action="delete-category" data-id="${category.id}">刪除</button></td></tr>`).join("") || '<tr><td colspan="6" class="empty">還沒有分類，先新增一個預算分類吧。</td></tr>'}
    </tbody></table></div></section>
    <section class="mobile-record-list">${rows.map(({ category, spent, percentage }) => `
      <article class="mobile-record-card">
        <div class="mobile-record-head"><strong><span class="color-dot" style="background:${category.color}"></span>${esc(category.name)}</strong><span>${percentage}%</span></div>
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
    (!filterStatus || entry.status === filterStatus));
}

function entryRow(entry: LedgerEntry, isFunding: boolean) {
  return `<tr><td>${dateLabel(entry.occurredOn)}</td><td><strong>${esc(entry.description)}</strong>${entry.attachments.length ? `<small class="attachment-count">⌁ ${entry.attachments.length} 張憑證</small>` : ""}</td><td>${esc(isFunding ? entry.counterparty : categoryName(entry.categoryId))}</td><td>${esc(entry.paymentMethod || "—")}</td><td><span class="status ${entryStatusClass(entry)}">${entryStatusText(entry)}</span></td><td class="amount ${entryAmountClass(entry)}">${entryAmountSign(entry)}${formatMoney(entry.amount)}</td><td class="row-actions"><button data-action="edit-entry" data-id="${entry.id}">編輯</button><button data-action="delete-entry" data-id="${entry.id}">刪除</button></td></tr>`;
}

function entryCard(entry: LedgerEntry, isFunding: boolean) {
  return `<article class="mobile-record-card">
    <div class="mobile-record-head"><div><small>${dateLabel(entry.occurredOn)}</small><strong>${esc(entry.description)}</strong></div><b class="amount ${entryAmountClass(entry)}">${entryAmountSign(entry)}${formatMoney(entry.amount)}</b></div>
    <div class="mobile-entry-meta"><span>${esc(isFunding ? entry.counterparty || "未填來源" : categoryName(entry.categoryId))}</span><span>${esc(entry.paymentMethod || "未指定方式")}</span><span class="status ${entryStatusClass(entry)}">${entryStatusText(entry)}</span>${entry.attachments.length ? `<span>⌁ ${entry.attachments.length} 張憑證</span>` : ""}</div>
    <div class="mobile-record-actions"><button data-action="edit-entry" data-id="${entry.id}">編輯</button><button class="danger-text" data-action="delete-entry" data-id="${entry.id}">刪除</button></div>
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
        if (entrySortKey === "paymentMethod") return entry.paymentMethod;
        if (entrySortKey === "status") return entryStatusText(entry);
        return entry.amount;
      };
      const compare = compareSortValue(value(left), value(right));
      return entrySortDirection === "asc" ? compare : -compare;
    });
  layout(`
    <section class="page-actions"><p>${isFunding ? "記錄實際收到的匯款，金額會直接增加可用資金。" : "管理已付款、待付款、退款與工程憑證。"}</p><button class="primary" data-action="new-entry" data-kind="${isFunding ? "income" : "expense"}">＋ 新增${isFunding ? "入帳" : "支出"}</button></section>
    <section class="filters panel"><label>搜尋<input id="search" placeholder="品項、對象或備註" value="${esc(query)}" /></label>${isFunding ? "" : `<label>分類<select id="category-filter"><option value="">全部分類</option>${payload!.categories.map((category) => `<option value="${category.id}" ${filterCategory === category.id ? "selected" : ""}>${esc(category.name)}</option>`).join("")}</select></label><label>狀態<select id="status-filter"><option value="">全部狀態</option><option value="posted" ${filterStatus === "posted" ? "selected" : ""}>已付款</option><option value="pending" ${filterStatus === "pending" ? "selected" : ""}>待付款</option><option value="refunded" ${filterStatus === "refunded" ? "selected" : ""}>已退款</option><option value="void" ${filterStatus === "void" ? "selected" : ""}>已作廢</option></select></label>`}</section>
    <section class="panel table-panel desktop-table"><div class="table-wrap"><table class="entry-table"><thead><tr><th><button class="sort-button" data-sort-entry="occurredOn">日期 ${sortIndicator("occurredOn", entrySortKey, entrySortDirection)}</button></th><th><button class="sort-button" data-sort-entry="description">品項 ${sortIndicator("description", entrySortKey, entrySortDirection)}</button></th><th><button class="sort-button" data-sort-entry="category">${isFunding ? "來源" : "分類"} ${sortIndicator("category", entrySortKey, entrySortDirection)}</button></th><th><button class="sort-button" data-sort-entry="paymentMethod">付款方式 ${sortIndicator("paymentMethod", entrySortKey, entrySortDirection)}</button></th><th><button class="sort-button" data-sort-entry="status">狀態 ${sortIndicator("status", entrySortKey, entrySortDirection)}</button></th><th><button class="sort-button" data-sort-entry="amount">金額 ${sortIndicator("amount", entrySortKey, entrySortDirection)}</button></th><th></th></tr></thead><tbody>${entries.map((entry) => entryRow(entry, isFunding)).join("") || '<tr><td colspan="7" class="empty">目前沒有符合條件的紀錄。</td></tr>'}</tbody></table></div></section>
    <section class="mobile-record-list">${entries.map((entry) => entryCard(entry, isFunding)).join("") || '<div class="panel empty">目前沒有符合條件的紀錄。</div>'}</section>`, view);
  document.querySelector<HTMLInputElement>("#search")?.addEventListener("change", (event) => {
    query = (event.target as HTMLInputElement).value;
    renderProjectPage(view);
  });
  document.querySelector<HTMLSelectElement>("#category-filter")?.addEventListener("change", (event) => {
    filterCategory = (event.target as HTMLSelectElement).value;
    renderProjectPage(view);
  });
  document.querySelector<HTMLSelectElement>("#status-filter")?.addEventListener("change", (event) => {
    filterStatus = (event.target as HTMLSelectElement).value;
    renderProjectPage(view);
  });
  document.querySelectorAll<HTMLElement>("[data-sort-entry]").forEach((button) => button.addEventListener("click", () => {
    const key = button.dataset.sortEntry as EntrySortKey;
    entrySortDirection = key === entrySortKey && entrySortDirection === "asc" ? "desc" : "asc";
    entrySortKey = key;
    renderEntries(view);
  }));
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
      <label>預估預算<input name="plannedAmount" type="number" min="0" step="1" required value="${existing?.plannedAmount ?? ""}" placeholder="0" /></label>
      <label>識別顏色<input name="color" type="color" value="${existing?.color ?? "#1d6f63"}" /></label>
      <div class="form-submit"><button type="button" class="secondary" data-action="close-modal">取消</button><button class="primary" type="submit">儲存分類</button></div>
    </form>`);
  document.querySelector<HTMLFormElement>("#category-form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    try {
      await saveCategory(currentProjectId(), {
        name: String(form.get("name")).trim(),
        plannedAmount: Number(form.get("plannedAmount")),
        color: String(form.get("color")),
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
  openModal(`
    <div class="modal-head"><div><p class="eyebrow">${kindLabel[kind]}</p><h3>${existing ? "編輯紀錄" : `新增${kindLabel[kind]}`}</h3></div><button class="icon-button" data-action="close-modal">×</button></div>
    <form id="entry-form" class="form-grid">
      <label>紀錄類型<select name="kind"><option value="expense" ${kind === "expense" ? "selected" : ""}>支出</option><option value="income" ${kind === "income" ? "selected" : ""}>資金入帳</option><option value="refund" ${kind === "refund" ? "selected" : ""}>退款</option></select></label>
      <label>品項／用途<input name="description" maxlength="80" required value="${esc(existing?.description ?? "")}" placeholder="例如：一樓配電材料" /></label>
      <label>金額<input name="amount" type="number" min="1" step="1" required value="${existing?.amount ?? ""}" /></label>
      <label>日期<input name="occurredOn" type="date" required value="${existing?.occurredOn ?? new Date().toISOString().slice(0, 10)}" /></label>
      <label>預算分類<select name="categoryId">${categoryOptions}</select></label>
      <label>對象<input name="counterparty" maxlength="60" value="${esc(existing?.counterparty ?? "")}" placeholder="廠商或匯款人" /></label>
      <label>付款方式<select name="paymentMethod"><option value="">未指定</option>${["銀行轉帳", "現金", "信用卡", "電子支付"].map((method) => `<option ${existing?.paymentMethod === method ? "selected" : ""}>${method}</option>`).join("")}</select></label>
      <label>狀態<select name="status"><option value="posted" ${existing?.status === "posted" || !existing ? "selected" : ""}>已入帳／已付款</option><option value="pending" ${existing?.status === "pending" ? "selected" : ""}>待付款</option><option value="refunded" ${existing?.status === "refunded" ? "selected" : ""}>已退款</option><option value="void" ${existing?.status === "void" ? "selected" : ""}>已作廢</option></select></label>
      <p class="form-hint full">將「支出」標記為已退款後，這筆金額會自動退回可用資金與預算餘額。</p>
      <label class="full">備註<textarea name="note" maxlength="500" placeholder="保固、報價或付款說明">${esc(existing?.note ?? "")}</textarea></label>
      <label class="full upload-field">憑證照片（JPG、PNG、WebP；最多 5 張，每張 10MB）<input name="files" type="file" accept="image/jpeg,image/png,image/webp" multiple /></label>
      <div class="form-submit"><button type="button" class="secondary" data-action="close-modal">取消</button><button class="primary" type="submit">儲存紀錄</button></div>
    </form>`);
  document.querySelector<HTMLFormElement>("#entry-form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget as HTMLFormElement;
    const form = new FormData(formElement);
    const files = [...(formElement.querySelector<HTMLInputElement>("[name='files']")?.files ?? [])];
    if (files.length + (existing?.attachments.length ?? 0) > 5 ||
      files.some((file) => file.size > 10 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type))) {
      return toast("每筆最多 5 張 JPG、PNG、WebP，且每張不得超過 10MB。", "error");
    }
    try {
      const projectId = currentProjectId();
      const result = await saveEntry(projectId, {
        kind: String(form.get("kind")) as EntryKind,
        status: String(form.get("status")) as LedgerEntry["status"],
        description: String(form.get("description")).trim(),
        amount: Number(form.get("amount")),
        occurredOn: String(form.get("occurredOn")),
        categoryId: String(form.get("categoryId")) || null,
        counterparty: String(form.get("counterparty")).trim(),
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
