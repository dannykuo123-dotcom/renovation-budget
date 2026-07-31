import "./cashbook-page.css";
import "./cashbook-minimal.css";
import {
  buildCashbookLedger,
  calculateTotals,
  sortCashbookActivities,
  type CashbookActivity,
} from "./finance";
import {
  activityInvolvesPerson,
  activityMatchesCategory,
  cashbookAmountPresentation,
  personInitial,
} from "./cashbook-view";
import {
  partitionCashbookActivities,
  type CashbookMobilePane,
  type CashbookViewMode,
} from "./cashbook-layout";
import { formatCashbookNumber } from "./cashbook-number";
import type { DashboardPayload, LedgerEntry, Person } from "./types";

export type CashbookTypeFilter = "all" | "income" | "expense" | "transfer";
export type CashbookSortDirection = "asc" | "desc";

export interface CashbookFilters {
  personId: string;
  type: CashbookTypeFilter;
  categoryId: string;
  query: string;
  sortDirection: CashbookSortDirection;
}

export interface CashbookPageOptions {
  payload: DashboardPayload;
  filters: CashbookFilters;
  viewMode: CashbookViewMode;
  dateLabel: (date: string) => string;
  layout: (content: string) => void;
  updateFilters: (patch: Partial<CashbookFilters>) => void;
  updateViewMode: (mode: CashbookViewMode) => void;
}

let openActivityId = "";
let currentProjectId = "";
let mobilePane: CashbookMobilePane = "income";
let removeCreateMenuKeydown: (() => void) | null = null;

const esc = (value: string) =>
  value.replace(/[&<>'"]/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);

function personById(payload: DashboardPayload, id: string | null): Person | undefined {
  return payload.people.find((person) => person.id === id);
}

function personLabel(person: Person | undefined): string {
  if (!person) return "未指定";
  return `${person.name}${person.role ? `（${person.role}）` : ""}`;
}

function personAvatar(person: Person | undefined): string {
  const label = personLabel(person);
  const initial = person ? personInitial(person.name) : "？";
  return `<span class="cashbook-row-avatar" role="img" aria-label="${esc(label)}" data-person-tooltip="${esc(label)}">${esc(initial)}</span>`;
}

function activityPeopleMarkup(activity: CashbookActivity, payload: DashboardPayload): string {
  if (activity.source === "transfer") {
    return `<span class="cashbook-row-people">${personAvatar(personById(payload, activity.fromPersonId))}<span class="cashbook-transfer-arrow" aria-hidden="true">→</span>${personAvatar(personById(payload, activity.toPersonId))}</span>`;
  }
  return `<span class="cashbook-row-people">${personAvatar(personById(payload, activity.personId))}</span>`;
}

function activityPeopleText(activity: CashbookActivity, payload: DashboardPayload): string {
  if (activity.source === "transfer") {
    return `${personLabel(personById(payload, activity.fromPersonId))} → ${personLabel(personById(payload, activity.toPersonId))}`;
  }
  return personLabel(personById(payload, activity.personId));
}

function activityTitle(activity: CashbookActivity): string {
  return activity.source === "transfer" ? "款項交接" : activity.description;
}

function activityTypeText(activity: CashbookActivity): string {
  if (activity.source === "transfer") return "轉移";
  return activity.kind === "income" ? "收入" : "支出";
}

function entryForActivity(activity: CashbookActivity, entries: LedgerEntry[]): LedgerEntry | undefined {
  return activity.source === "entry"
    ? entries.find((entry) => entry.id === activity.id)
    : undefined;
}

function categoryText(entry: LedgerEntry | undefined, payload: DashboardPayload): string {
  if (!entry || entry.kind !== "expense") return "不屬於預算分類";
  return payload.categories.find((category) => category.id === entry.categoryId)?.name ?? "未分類";
}

function activityStatusText(activity: CashbookActivity, entry: LedgerEntry | undefined): string {
  if (activity.source === "transfer") {
    return activity.status === "posted" ? "已完成" : activity.status === "pending" ? "待處理" : "已作廢";
  }
  if (!entry) return "未知";
  if (entry.status === "pending") return entry.kind === "expense" ? "待付款" : "待入帳";
  if (entry.status === "void") return "已作廢";
  return entry.kind === "expense" ? "已付款" : "已入帳";
}

function activityImpact(activity: CashbookActivity): string {
  if (activity.source === "transfer") return "只更換款項持有人，不影響工程收支";
  return activity.kind === "income" ? "增加工程收入與餘額" : "增加工程支出並減少餘額";
}

function activityAttachmentText(entry: LedgerEntry | undefined): string {
  if (!entry?.attachments.length) return "無憑證";
  return `${entry.attachments.length} 張憑證`;
}

function activityActions(activity: CashbookActivity): string {
  if (activity.source === "transfer") {
    return `<button data-action="edit-transfer" data-id="${activity.id}">編輯</button><button class="danger-text" data-action="delete-transfer" data-id="${activity.id}">刪除</button>`;
  }
  return `<button data-action="edit-entry" data-id="${activity.id}">編輯</button><button class="danger-text" data-action="delete-entry" data-id="${activity.id}">刪除</button>`;
}

function activityDetailMarkup(
  activity: CashbookActivity,
  entry: LedgerEntry | undefined,
  payload: DashboardPayload,
): string {
  const balance = activity.runningBalance === null
    ? "未入帳"
    : formatCashbookNumber(activity.runningBalance);
  const note = activity.note || (activity.source === "transfer" ? "人員間款項交接" : "未填寫備註");
  return `<div class="cashbook-detail-panel">
    <div class="cashbook-detail-facts">
      <span><small>類型／分類</small><b>${activityTypeText(activity)} · ${esc(categoryText(entry, payload))}</b></span>
      <span><small>狀態／付款方式</small><b>${activityStatusText(activity, entry)} · ${esc(activity.paymentMethod || "未指定")}</b></span>
      <span><small>工程餘額</small><b>${balance}</b></span>
      <span><small>帳務影響</small><b>${activityImpact(activity)}</b></span>
      <span><small>備註</small><b>${esc(note)}</b></span>
      <span><small>憑證</small><b>${activityAttachmentText(entry)}</b></span>
    </div>
    <div class="cashbook-detail-actions">${activityActions(activity)}</div>
  </div>`;
}

function activityMatchesType(activity: CashbookActivity, filter: CashbookTypeFilter): boolean {
  if (filter === "all") return true;
  if (filter === "transfer") return activity.source === "transfer";
  return activity.kind === filter;
}

function activitySearchText(
  activity: CashbookActivity,
  entry: LedgerEntry | undefined,
  payload: DashboardPayload,
): string {
  return [
    activityTitle(activity),
    activityPeopleText(activity, payload),
    categoryText(entry, payload),
    activity.paymentMethod,
    activity.note,
  ].join(" ").toLocaleLowerCase("zh-Hant");
}

function personFilterMarkup(person: Person | undefined, selectedId: string): string {
  const id = person?.id ?? "";
  const label = person ? `${person.name}${person.active ? "" : "（停用）"}` : "全部人員";
  const initial = person ? personInitial(person.name) : "全";
  return `<button class="cashbook-person-filter ${id === selectedId ? "is-selected" : ""}" type="button" data-cashbook-person="${id}" aria-label="${esc(label)}" title="${esc(label)}" aria-pressed="${id === selectedId}">
    <span class="cashbook-person-avatar" aria-hidden="true">${esc(initial)}</span>
  </button>`;
}

function filterChip(
  label: string,
  value: string,
  selectedValue: string,
  attribute: "type" | "category",
): string {
  return `<button class="cashbook-filter-chip ${value === selectedValue ? "is-selected" : ""}" type="button" data-cashbook-${attribute}="${value}" aria-pressed="${value === selectedValue}">${esc(label)}</button>`;
}

export function renderCashbookPage(options: CashbookPageOptions): void {
  const { payload, filters } = options;
  if (currentProjectId !== payload.project.id) {
    currentProjectId = payload.project.id;
    openActivityId = "";
    mobilePane = "income";
  }

  const peopleWithHistory = payload.people
    .filter((person) => person.active ||
      payload.entries.some((entry) => entry.personId === person.id) ||
      payload.transfers.some((transfer) =>
        transfer.fromPersonId === person.id || transfer.toPersonId === person.id))
    .sort((left, right) =>
      Number(right.active) - Number(left.active) ||
      left.name.localeCompare(right.name, "zh-Hant"));
  const selectedPerson = peopleWithHistory.find((person) => person.id === filters.personId);
  const selectedPersonId = selectedPerson?.id ?? "";
  const totals = calculateTotals(payload.spaces, payload.entries);
  const ledger = buildCashbookLedger(payload.entries, payload.transfers, null);
  const normalizedQuery = filters.query.trim().toLocaleLowerCase("zh-Hant");
  const activities = sortCashbookActivities(
    ledger.activities.filter((activity) => {
      const entry = entryForActivity(activity, payload.entries);
      return activityInvolvesPerson(activity, selectedPersonId || null) &&
        activityMatchesType(activity, filters.type) &&
        activityMatchesCategory(activity, entry?.categoryId ?? null, filters.categoryId) &&
        (!normalizedQuery || activitySearchText(activity, entry, payload).includes(normalizedQuery));
    }),
    filters.sortDirection,
  );
  if (openActivityId && !activities.some((activity) => activity.id === openActivityId)) {
    openActivityId = "";
  }

  const activityGroups = partitionCashbookActivities(activities);
  const unassignedCount = payload.entries
    .filter((entry) => entry.status !== "void" && !entry.personId).length;
  const selectedPersonData = selectedPerson?.active ? ` data-person-id="${selectedPerson.id}"` : "";
  const peopleFilters = [
    personFilterMarkup(undefined, selectedPersonId),
    ...peopleWithHistory.map((person) => personFilterMarkup(person, selectedPersonId)),
  ].join("");
  const typeFilters = [
    filterChip("全部", "all", filters.type, "type"),
    filterChip("收入", "income", filters.type, "type"),
    filterChip("支出", "expense", filters.type, "type"),
    filterChip("轉移", "transfer", filters.type, "type"),
  ].join("");
  const categoryFilters = [
    filterChip("全部", "", filters.categoryId, "category"),
    ...payload.categories.map((category) =>
      filterChip(category.name, category.id, filters.categoryId, "category")),
  ].join("");

  const pendingMarkup = (activity: CashbookActivity) =>
    activity.status === "pending" ? '<span class="cashbook-pending-badge">待處理</span>' : "";

  const rowMarkup = (activity: CashbookActivity) => {
    const entry = entryForActivity(activity, payload.entries);
    const amount = cashbookAmountPresentation(activity.amount, activity.kind);
    const open = openActivityId === activity.id;
    return `<tr class="cashbook-ledger-row" data-cashbook-toggle="${activity.id}">
      <td>${activityPeopleMarkup(activity, payload)}</td>
      <td>${options.dateLabel(activity.occurredOn)}</td>
      <td><button class="cashbook-item-toggle" type="button" aria-expanded="${open}">
        <span class="cashbook-item-name">${esc(activityTitle(activity))}${pendingMarkup(activity)}</span>
        <span class="cashbook-row-chevron" aria-hidden="true">${open ? "⌃" : "⌄"}</span>
      </button></td>
      <td class="cashbook-amount cashbook-amount-${amount.tone}">${amount.text}</td>
    </tr>${open ? `<tr class="cashbook-detail-row"><td colspan="4">${activityDetailMarkup(activity, entry, payload)}</td></tr>` : ""}`;
  };

  const cardMarkup = (activity: CashbookActivity, variant: "mobile" | "split" = "mobile") => {
    const entry = entryForActivity(activity, payload.entries);
    const amount = cashbookAmountPresentation(activity.amount, activity.kind);
    const open = openActivityId === activity.id;
    return `<article class="cashbook-${variant}-card">
      <button class="cashbook-${variant}-summary" type="button" data-cashbook-toggle="${activity.id}" aria-expanded="${open}">
        <span>${activityPeopleMarkup(activity, payload)}</span>
        <span class="cashbook-card-date">${options.dateLabel(activity.occurredOn)}</span>
        <span class="cashbook-card-item">${esc(activityTitle(activity))}${pendingMarkup(activity)}</span>
        <span class="cashbook-amount cashbook-amount-${amount.tone}">${amount.text}</span>
      </button>
      ${open ? `<div class="cashbook-card-detail">${activityDetailMarkup(activity, entry, payload)}</div>` : ""}
    </article>`;
  };

  const cardsMarkup = (items: CashbookActivity[]) =>
    items.map((activity) => cardMarkup(activity, "split")).join("") ||
    '<div class="cashbook-split-empty">目前沒有交易</div>';

  const splitSectionMarkup = (
    title: string,
    tone: "income" | "expense" | "transfer",
    items: CashbookActivity[],
    className = "",
  ) => `<section class="cashbook-split-section cashbook-split-${tone} ${className}">
    <header><strong>${title}</strong><span>${items.length}</span></header>
    <div class="cashbook-split-list">${cardsMarkup(items)}</div>
  </section>`;

  const listMarkup = `
    <section class="panel table-panel cashbook-ledger-desktop"><div class="table-wrap"><table class="cashbook-ledger-table">
      <thead><tr><th>人員</th><th>日期</th><th>項目</th><th>金額</th></tr></thead>
      <tbody>${activities.map(rowMarkup).join("") || '<tr><td colspan="4" class="empty">目前沒有符合條件的交易。</td></tr>'}</tbody>
    </table></div></section>
    <section class="cashbook-ledger-mobile">${activities.map((activity) => cardMarkup(activity)).join("") || '<div class="panel empty">目前沒有符合條件的交易。</div>'}</section>`;

  const activeMobileItems = mobilePane === "income" ? activityGroups.income : activityGroups.expense;
  const splitMarkup = `
    <section class="cashbook-split-desktop">
      <div class="cashbook-split-grid">
        ${splitSectionMarkup("收入", "income", activityGroups.income)}
        ${splitSectionMarkup("支出", "expense", activityGroups.expense)}
        ${splitSectionMarkup("轉移", "transfer", activityGroups.transfer, "cashbook-transfer-full")}
      </div>
    </section>
    <section class="cashbook-split-mobile">
      <div class="cashbook-split-tabs" role="tablist" aria-label="切換收入或支出">
        <button type="button" role="tab" data-cashbook-mobile-pane="income" aria-selected="${mobilePane === "income"}" class="${mobilePane === "income" ? "is-selected" : ""}">收入 <span>${activityGroups.income.length}</span></button>
        <button type="button" role="tab" data-cashbook-mobile-pane="expense" aria-selected="${mobilePane === "expense"}" class="${mobilePane === "expense" ? "is-selected" : ""}">支出 <span>${activityGroups.expense.length}</span></button>
      </div>
      ${splitSectionMarkup(mobilePane === "income" ? "收入" : "支出", mobilePane, activeMobileItems, "cashbook-mobile-active-section")}
      ${splitSectionMarkup("轉移", "transfer", activityGroups.transfer, "cashbook-transfer-full")}
    </section>`;

  options.layout(`
    <section class="cashbook-summary-shell">
      <div class="cashbook-summary-scroll">
        <div class="cashbook-summary-strip cashbook-summary-four">
          <article class="summary-budget"><small>屋主預算</small><strong>${formatCashbookNumber(payload.project.ownerBudget)}</strong></article>
          <article class="summary-income"><small>收入</small><strong>${formatCashbookNumber(totals.received)}</strong></article>
          <article class="summary-expense"><small>支出</small><strong>${formatCashbookNumber(totals.spent)}</strong></article>
          <article class="summary-balance"><small>餘額</small><strong>${formatCashbookNumber(totals.cashBalance)}</strong></article>
        </div>
      </div>
      <div class="cashbook-create-toolbar">
        <button class="cashbook-create-toggle" id="cashbook-create-toggle" type="button" aria-label="新增帳務" aria-expanded="false">＋</button>
        <div class="cashbook-create-menu" id="cashbook-create-menu" hidden>
          <button class="secondary expense-action" data-action="new-entry" data-kind="expense"${selectedPersonData}>支出</button>
          <button class="secondary income-action" data-action="new-entry" data-kind="income"${selectedPersonData}>收入</button>
          <button class="secondary transfer-action" data-action="new-transfer">轉移</button>
        </div>
      </div>
    </section>
    ${unassignedCount ? `<div class="cashbook-unassigned-note" title="人員篩選時不列入">${unassignedCount} 筆未指定人員</div>` : ""}
    <section class="cashbook-filter-deck" aria-label="帳本篩選">
      <div class="cashbook-filter-line">
        <div class="cashbook-filter-group"><span class="cashbook-filter-label">人員</span><div class="cashbook-filter-options cashbook-people-options">${peopleFilters}</div></div>
        <div class="cashbook-filter-divider" aria-hidden="true"></div>
        <div class="cashbook-filter-group"><span class="cashbook-filter-label">類型</span><div class="cashbook-filter-options">${typeFilters}</div></div>
        ${payload.categories.length ? `<div class="cashbook-filter-divider" aria-hidden="true"></div><div class="cashbook-filter-group"><span class="cashbook-filter-label">分類</span><div class="cashbook-filter-options">${categoryFilters}</div></div>` : ""}
      </div>
    </section>
    <section class="cashbook-list-toolbar">
      <small class="cashbook-result-count">${activities.length} 筆</small>
      <input class="cashbook-search-input" id="cashbook-search-input" type="search" aria-label="搜尋項目、人員或備註" placeholder="搜尋項目、人員或備註" value="${esc(filters.query)}" ${filters.query ? "" : "hidden"} />
      <button class="secondary cashbook-date-sort" id="cashbook-date-sort" type="button" aria-label="切換日期排序">
        <i class="ph ${filters.sortDirection === "desc" ? "ph-sort-descending" : "ph-sort-ascending"}" aria-hidden="true"></i><span>日期</span>
      </button>
      <button class="secondary cashbook-search-toggle" id="cashbook-search-toggle" type="button" aria-label="搜尋"><i class="ph ph-magnifying-glass" aria-hidden="true"></i></button>
      <div class="cashbook-view-switch" role="group" aria-label="顯示模式">
        <button type="button" data-cashbook-view="list" aria-label="清單模式" title="清單模式" aria-pressed="${options.viewMode === "list"}" class="${options.viewMode === "list" ? "is-selected" : ""}"><i class="ph ph-list" aria-hidden="true"></i></button>
        <button type="button" data-cashbook-view="split" aria-label="左右模式" title="左右模式" aria-pressed="${options.viewMode === "split"}" class="${options.viewMode === "split" ? "is-selected" : ""}"><i class="ph ph-columns" aria-hidden="true"></i></button>
      </div>
    </section>
    ${options.viewMode === "split" ? splitMarkup : listMarkup}
  `);

  const createToggle = document.querySelector<HTMLButtonElement>("#cashbook-create-toggle");
  const createMenu = document.querySelector<HTMLElement>("#cashbook-create-menu");
  const closeCreateMenu = () => {
    if (!createToggle || !createMenu) return;
    createMenu.hidden = true;
    createToggle.setAttribute("aria-expanded", "false");
  };
  createToggle?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!createMenu) return;
    const opening = createMenu.hidden;
    createMenu.hidden = !opening;
    createToggle.setAttribute("aria-expanded", String(opening));
    if (opening) {
      const closeOnOutsideClick = () => closeCreateMenu();
      document.addEventListener("click", closeOnOutsideClick, { once: true });
    }
  });
  removeCreateMenuKeydown?.();
  const handleCreateMenuKeydown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || createMenu?.hidden) return;
    closeCreateMenu();
    createToggle?.focus();
  };
  document.addEventListener("keydown", handleCreateMenuKeydown);
  removeCreateMenuKeydown = () =>
    document.removeEventListener("keydown", handleCreateMenuKeydown);

  document.querySelectorAll<HTMLButtonElement>("[data-cashbook-type]").forEach((button) =>
    button.addEventListener("click", () =>
      options.updateFilters({ type: button.dataset.cashbookType as CashbookTypeFilter })));
  document.querySelectorAll<HTMLButtonElement>("[data-cashbook-person]").forEach((button) =>
    button.addEventListener("click", () =>
      options.updateFilters({ personId: button.dataset.cashbookPerson ?? "" })));
  document.querySelectorAll<HTMLButtonElement>("[data-cashbook-category]").forEach((button) =>
    button.addEventListener("click", () =>
      options.updateFilters({ categoryId: button.dataset.cashbookCategory ?? "" })));
  document.querySelectorAll<HTMLButtonElement>("[data-cashbook-view]").forEach((button) =>
    button.addEventListener("click", () =>
      options.updateViewMode(button.dataset.cashbookView as CashbookViewMode)));
  document.querySelectorAll<HTMLButtonElement>("[data-cashbook-mobile-pane]").forEach((button) =>
    button.addEventListener("click", () => {
      mobilePane = button.dataset.cashbookMobilePane as CashbookMobilePane;
      openActivityId = "";
      renderCashbookPage(options);
    }));
  document.querySelectorAll<HTMLElement>("[data-cashbook-toggle]").forEach((row) =>
    row.addEventListener("click", () => {
      const id = row.dataset.cashbookToggle ?? "";
      openActivityId = openActivityId === id ? "" : id;
      renderCashbookPage(options);
    }));
  document.querySelector<HTMLButtonElement>("#cashbook-date-sort")?.addEventListener("click", () =>
    options.updateFilters({ sortDirection: filters.sortDirection === "desc" ? "asc" : "desc" }));
  const searchInput = document.querySelector<HTMLInputElement>("#cashbook-search-input");
  const applySearch = () =>
    options.updateFilters({ query: searchInput?.value.trim() ?? "" });
  searchInput?.addEventListener("change", applySearch);
  searchInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    applySearch();
  });
  document.querySelector<HTMLButtonElement>("#cashbook-search-toggle")?.addEventListener("click", () => {
    const input = document.querySelector<HTMLInputElement>("#cashbook-search-input");
    if (!input) return;
    input.hidden = !input.hidden;
    if (!input.hidden) input.focus();
  });
}
