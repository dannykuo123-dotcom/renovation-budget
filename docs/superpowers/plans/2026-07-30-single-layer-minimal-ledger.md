# Single-Layer Minimal Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sidebar and verbose ledger forms with a glass top navigation, compact direct filters, and minimal income/expense/transfer forms without changing stored data or API contracts.

**Architecture:** Keep routing, API calls, finance calculations, and submission payloads in `main.ts`. Extract pure form-presentation decisions into `ledger-form-view.ts` so they can be test-driven, then update the existing layout and modal markup in place. Add one external animated SVG brand asset and use Phosphor Icons for standard interface icons.

**Tech Stack:** TypeScript 5.8, Vite 7, Vitest 3, plain HTML/CSS, `@phosphor-icons/web`.

## Global Constraints

- Do not modify backend API, database schema, stored records, finance calculations, or request payload shapes.
- Desktop navigation is one sticky glass row; mobile keeps the same row and may horizontally scroll inside its own container.
- Options with five or fewer values render directly as segmented buttons instead of closed select menus.
- Income has no visible status selector and submits `posted`.
- Entry and transfer primary buttons read `儲存`.
- The page must not horizontally overflow at 320px.
- Preserve keyboard access, focus states, validation, attachment limits, modal close behavior, and existing toasts.

---

### Task 1: Test-driven minimal form presentation rules

**Files:**
- Create: `web/src/ledger-form-view.test.ts`
- Create: `web/src/ledger-form-view.ts`

**Interfaces:**
- Consumes: `EntryKind`, `LedgerEntry["status"]`, `FundTransfer["status"]`.
- Produces: `entryStatusChoices(kind)`, `entryStatusValue(kind, selected)`, `paymentMethodChoices`, and `compactPaymentMethodLabel(value)`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
  compactPaymentMethodLabel,
  entryStatusChoices,
  entryStatusValue,
  paymentMethodChoices,
} from "./ledger-form-view";

describe("minimal ledger form choices", () => {
  it("keeps the single income status implicit", () => {
    expect(entryStatusChoices("income")).toEqual([]);
    expect(entryStatusValue("income", "pending")).toBe("posted");
  });

  it("exposes only the two useful expense states", () => {
    expect(entryStatusChoices("expense")).toEqual([
      { value: "posted", label: "已付款" },
      { value: "pending", label: "待付款" },
    ]);
  });

  it("uses compact payment labels without changing submitted values", () => {
    expect(paymentMethodChoices.map((choice) => choice.value)).toEqual([
      "", "銀行轉帳", "現金", "信用卡", "電子支付",
    ]);
    expect(compactPaymentMethodLabel("銀行轉帳")).toBe("轉帳");
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm.cmd run test --workspace web -- ledger-form-view.test.ts`

Expected: FAIL because `./ledger-form-view` does not exist.

- [ ] **Step 3: Implement the pure presentation rules**

```ts
import type { EntryKind, LedgerEntry } from "./types";

export interface DirectChoice<T extends string> {
  value: T;
  label: string;
}

export const paymentMethodChoices: DirectChoice<string>[] = [
  { value: "", label: "未指定" },
  { value: "銀行轉帳", label: "轉帳" },
  { value: "現金", label: "現金" },
  { value: "信用卡", label: "信用卡" },
  { value: "電子支付", label: "電子支付" },
];

export function compactPaymentMethodLabel(value: string): string {
  return paymentMethodChoices.find((choice) => choice.value === value)?.label ?? value;
}

export function entryStatusChoices(kind: EntryKind): DirectChoice<LedgerEntry["status"]>[] {
  return kind === "income"
    ? []
    : [{ value: "posted", label: "已付款" }, { value: "pending", label: "待付款" }];
}

export function entryStatusValue(
  kind: EntryKind,
  selected: LedgerEntry["status"],
): LedgerEntry["status"] {
  return kind === "income" ? "posted" : selected;
}
```

- [ ] **Step 4: Run targeted tests and verify GREEN**

Run: `npm.cmd run test --workspace web -- ledger-form-view.test.ts`

Expected: all new tests pass.

---

### Task 2: Replace the sidebar with a glass top navigation

**Files:**
- Create: `web/public/rainbow-interior-logo.svg`
- Modify: `web/src/main.ts`
- Modify: `web/src/style.css`
- Modify: `web/package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: existing `navLink()`, `layout()`, project routes, refresh and logout actions.
- Produces: `.glass-topbar`, `.brand-lockup`, `.top-nav`, and `.topbar-actions`.

- [ ] **Step 1: Install the standard icon asset dependency**

Run: `npm.cmd install @phosphor-icons/web --workspace web`

Expected: dependency is recorded in `web/package.json` and `package-lock.json`.

- [ ] **Step 2: Add the animated gradient logo asset**

Create an external SVG with a rounded-square mark, animated gradient stops, and the letters `RI`. It must contain an accessible `<title>彩虹室內設計</title>` and respect `prefers-reduced-motion` by disabling its animation.

- [ ] **Step 3: Replace layout markup**

Update `layout()` so the app shell is:

```html
<div class="app-shell topbar-shell">
  <header class="glass-topbar">
    <a class="brand-lockup" href="#/projects">
      <img src="/rainbow-interior-logo.svg" alt="" />
      <span><strong>彩虹室內設計</strong><small>RAINBOW INTERIOR DESIGN</small></span>
    </a>
    <a class="project-switch" href="#/projects">目前工程名稱</a>
    <nav class="top-nav" aria-label="工程導覽">
      <a class="nav-item" href="#/projects/:id/dashboard">總覽</a>
      <a class="nav-item" href="#/projects/:id/budget">預算</a>
      <a class="nav-item active" href="#/projects/:id/cashflow">帳本</a>
      <a class="nav-item" href="#/projects/:id/settings">設定</a>
    </nav>
    <div class="topbar-actions">重新整理、登出</div>
  </header>
  <main class="content topbar-content"><h2>工程帳本</h2></main>
</div>
```

Remove the page eyebrow containing `project.name`. Keep the main heading and existing route/action attributes.

- [ ] **Step 4: Add responsive glass navigation styles**

Implement a sticky translucent header with `backdrop-filter`, a subtle border, and an opaque fallback. Active navigation is dark green with white text. At 760px and below, allow `.top-nav` to scroll horizontally while `.glass-topbar` remains within viewport width.

- [ ] **Step 5: Build-check the navigation**

Run: `npm.cmd run build`

Expected: TypeScript and Vite build pass with no missing icon or asset references.

---

### Task 3: Simplify income, expense, and transfer modals

**Files:**
- Modify: `web/src/main.ts`
- Modify: `web/src/style.css`
- Test: `web/src/ledger-form-view.test.ts`

**Interfaces:**
- Consumes: Task 1 choice helpers, existing `saveEntry()`, `saveTransfer()`, `uploadAttachments()`, `activePersonOptions()`.
- Produces: reusable direct-choice markup and listener binding that keeps hidden form inputs synchronized.

- [ ] **Step 1: Add a failing test for transfer states**

Extend `ledger-form-view.test.ts`:

```ts
it("keeps all transfer states as direct choices", () => {
  expect(transferStatusChoices).toEqual([
    { value: "posted", label: "已完成" },
    { value: "pending", label: "待處理" },
    { value: "void", label: "已作廢" },
  ]);
});
```

Run: `npm.cmd run test --workspace web -- ledger-form-view.test.ts`

Expected: FAIL because `transferStatusChoices` is not exported.

- [ ] **Step 2: Implement transfer status choices and verify GREEN**

Add the exported constant with the exact values above, then rerun the targeted test.

- [ ] **Step 3: Add reusable direct-choice controls**

In `main.ts`, add:

```ts
function directChoices(
  name: string,
  choices: Array<{ value: string; label: string }>,
  selected: string,
): string
```

It renders one hidden input plus labelled buttons using `data-direct-choice`, `aria-pressed`, and escaped values. Add `bindDirectChoices(form)` to update the hidden input, selected state, and required validation.

- [ ] **Step 4: Rewrite the entry modal**

Remove the readonly type field, form hint, verbose attachment label, and visible income status. Render direct choices for category when categories exist, person, payment method, and expense status. Keep description, amount, date, note, and file input names unchanged. Change the submit label to `儲存`.

- [ ] **Step 5: Rewrite the transfer modal**

Render direct people choices for both directions, payment method and status choices, preserve all field names, and change the submit label to `儲存`.

- [ ] **Step 6: Add polished date and upload interactions**

Style date inputs as button-like controls with the Phosphor calendar icon positioned beside them. Convert `.upload-field` into a large drop zone labelled `上傳憑證`; clicking opens the file picker, dragging adds hover state, and a sibling status text shows `尚未選擇檔案`, one filename, or `已選擇 N 個檔案`.

- [ ] **Step 7: Run tests and build**

Run:

```powershell
npm.cmd test
npm.cmd run build
```

Expected: all tests and both web/worker builds pass.

---

### Task 4: Compress ledger filters and toolbar

**Files:**
- Modify: `web/src/cashbook-page.ts`
- Modify: `web/src/cashbook-page.css`

**Interfaces:**
- Consumes: current cashbook filter state and update callbacks.
- Produces: two-row `.cashbook-filter-deck` and single `.cashbook-list-toolbar`.

- [ ] **Step 1: Reorder filter markup**

Render the people row first. Render type and category groups inside the second row:

```html
<section class="cashbook-filter-deck">
  <div class="cashbook-filter-row cashbook-people-row">
    <span>人員</span>
    <button data-cashbook-person="">全部</button>
    <button data-cashbook-person="person-id">浩</button>
  </div>
  <div class="cashbook-filter-row cashbook-combined-row">
    <div class="cashbook-filter-group">
      <span>類型</span>
      <button data-cashbook-type="all">全部</button>
      <button data-cashbook-type="income">收入</button>
      <button data-cashbook-type="expense">支出</button>
      <button data-cashbook-type="transfer">轉移</button>
    </div>
    <div class="cashbook-filter-group"><span>分類</span><button data-cashbook-category="">全部</button></div>
  </div>
</section>
```

Omit the category group when there are no categories.

- [ ] **Step 2: Redesign search and sorting controls**

Keep the record count, collapsible search field, and date sort in one toolbar. Use Phosphor magnifying-glass and sort-direction icons with `aria-label` text. Remove the visible word `日期` from the compact control while keeping its accessible name.

- [ ] **Step 3: Compress desktop and mobile CSS**

Use smaller gaps, one shared border container, horizontal scrolling within choice rows, and no page-level overflow. Ensure the people row remains first at all breakpoints.

- [ ] **Step 4: Run full automated verification**

Run:

```powershell
npm.cmd test
npm.cmd run build
git diff --check
```

Expected: all commands pass.

---

### Task 5: Browser and design QA

**Files:**
- Modify: `design-qa.md`

**Interfaces:**
- Consumes: the four user screenshots and the running Vite app.
- Produces: final browser screenshots and `design-qa.md` with `final result: passed`.

- [ ] **Step 1: Verify desktop**

At a desktop viewport, check the glass topbar, animated brand asset, active navigation, compact filter order, search, sort, create menu, entry modal, transfer modal, date picker trigger, upload drop zone, and `儲存`.

- [ ] **Step 2: Verify mobile**

At 320px and 760px, verify no page horizontal overflow, top-nav internal scrolling, one-column form layout, bottom-sheet modal, compact filters, and readable transaction rows.

- [ ] **Step 3: Check console and interactions**

Verify no console errors or warnings. Test keyboard focus, modal close, direct-choice updates, search Enter behavior, and single accordion expansion.

- [ ] **Step 4: Update design QA**

Record source and implementation evidence, comparison history, responsive metrics, interaction checks, and exact `final result: passed`.

---

### Task 6: Final delivery

**Files:**
- Stage only files listed in Tasks 1–5.

**Interfaces:**
- Consumes: verified implementation and QA report.
- Produces: final #1069 commit pushed to the current branch.

- [ ] **Step 1: Run final verification**

Run:

```powershell
npm.cmd test
npm.cmd run build
git diff --check
git status --short
```

Expected: tests/build pass, diff check is clean, and only #1069 files are modified.

- [ ] **Step 2: Commit**

Run:

```powershell
git add -- web/src/main.ts web/src/style.css web/src/cashbook-page.ts web/src/cashbook-page.css web/src/ledger-form-view.ts web/src/ledger-form-view.test.ts web/public/rainbow-interior-logo.svg web/package.json package-lock.json design-qa.md docs/superpowers/plans/2026-07-30-single-layer-minimal-ledger.md
git commit -m "refactor: 大幅簡化帳本介面 #1069"
```

- [ ] **Step 3: Push**

Run: `git push origin main`

Expected: the current branch is synchronized with `origin/main`; do not create a pull request.
