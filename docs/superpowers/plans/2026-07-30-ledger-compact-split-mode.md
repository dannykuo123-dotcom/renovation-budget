# 帳本極致壓縮與左右模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除帳本標題空間、修正並升級動畫品牌、合併摘要與篩選列，並新增清單／收入支出左右模式。

**Architecture:** 保留既有 `CashbookActivity`、API 與財務計算。新增一個純顯示輔助模組負責模式與三類活動分組；模式存入既有專案篩選快取。`cashbook-page.ts` 只負責渲染與互動，響應式配置放在帳本專屬 CSS。

**Tech Stack:** TypeScript 5.8、Vite 7、Vitest 3、原生 HTML/CSS、Phosphor Icons、外部 SVG。

## Global Constraints

- 不變更後端 API、資料庫、帳務資料或財務計算。
- 工程帳本頁不顯示大標題，其他頁標題不變。
- 品牌圖片必須在 GitHub Pages `/renovation-budget/` 子路徑載入。
- 摘要不受篩選與模式影響。
- 轉移不列入收入或支出，左右模式中放在下方全寬區。
- 320px 不允許應用程式層級水平溢出。
- 人員篩選只顯示首字圓形頭像，完整姓名放在 tooltip 與無障礙名稱。
- 所有動畫尊重 `prefers-reduced-motion`。

---

### Task 1: 測試驅動帳本模式與活動分組

**Files:**
- Create: `web/src/cashbook-layout.ts`
- Create: `web/src/cashbook-layout.test.ts`

**Interfaces:**
- Consumes: `CashbookActivity` from `web/src/finance.ts`.
- Produces: `CashbookViewMode`, `CashbookMobilePane`, `partitionCashbookActivities(activities)`.

- [ ] **Step 1: 寫入失敗測試**

```ts
import { describe, expect, it } from "vitest";
import { partitionCashbookActivities } from "./cashbook-layout";

describe("partitionCashbookActivities", () => {
  it("keeps transfers separate from project income and expense", () => {
    const activities = [
      { id: "i", kind: "income" },
      { id: "e", kind: "expense" },
      { id: "t", kind: "transfer" },
    ] as never[];

    expect(partitionCashbookActivities(activities)).toEqual({
      income: [activities[0]],
      expense: [activities[1]],
      transfer: [activities[2]],
    });
  });
});
```

- [ ] **Step 2: 執行 RED**

Run: `npm.cmd test --workspace web -- cashbook-layout.test.ts`

Expected: FAIL because `cashbook-layout.ts` does not exist.

- [ ] **Step 3: 加入最小實作**

```ts
import type { CashbookActivity } from "./finance";

export type CashbookViewMode = "list" | "split";
export type CashbookMobilePane = "income" | "expense";

export function partitionCashbookActivities(activities: CashbookActivity[]) {
  return {
    income: activities.filter((activity) => activity.kind === "income"),
    expense: activities.filter((activity) => activity.kind === "expense"),
    transfer: activities.filter((activity) => activity.kind === "transfer"),
  };
}
```

- [ ] **Step 4: 執行 GREEN**

Run: `npm.cmd test --workspace web -- cashbook-layout.test.ts`

Expected: new test passes.

---

### Task 2: 將顯示模式加入既有篩選快取

**Files:**
- Modify: `web/src/filter-cache.ts`
- Modify: `web/src/filter-cache.test.ts`
- Modify: `web/src/main.ts`

**Interfaces:**
- Consumes: `CashbookViewMode`.
- Produces: cached `viewMode?: "list" | "split"` per project cashflow view.

- [ ] **Step 1: 寫入模式快取失敗測試**

```ts
it("keeps the cashbook view mode per project", () => {
  writeCachedFilters(storage, "p1", "cashflow", { viewMode: "split" });
  expect(readCachedFilters(storage, "p1", "cashflow").viewMode).toBe("split");
});
```

- [ ] **Step 2: 執行 RED**

Run: `npm.cmd test --workspace web -- filter-cache.test.ts`

Expected: TypeScript or assertion fails because `viewMode` is not part of the cache shape.

- [ ] **Step 3: 擴充快取介面與 main 狀態**

Add `viewMode?: CashbookViewMode` to `CachedFilters`. In `main.ts`, initialize `cashbookViewMode` to `list`, restore only `list` or `split`, and persist it with existing cashflow filters.

- [ ] **Step 4: 執行 GREEN**

Run: `npm.cmd test --workspace web -- filter-cache.test.ts`

Expected: cache tests pass.

---

### Task 3: 修正品牌、移除標題並壓縮摘要與篩選

**Files:**
- Modify: `web/public/rainbow-interior-logo.svg`
- Modify: `web/src/main.ts`
- Modify: `web/src/style.css`
- Modify: `web/src/cashbook-page.ts`
- Modify: `web/src/cashbook-page.css`
- Modify: `web/src/cashbook-minimal.css`

**Interfaces:**
- Consumes: `import.meta.env.BASE_URL`, current create menu and filter callbacks.
- Produces: full SVG lockup, `.cashbook-summary-toolbar`, `.cashbook-filter-line`.

- [ ] **Step 1: 重做完整品牌 SVG**

Use a `viewBox` sized for a horizontal lockup. Include animated gradient stops, a moving highlight, Chinese and English text, accessible `<title>`, and reduced-motion CSS. Keep it external.

- [ ] **Step 2: 修正資產路徑**

In `main.ts`:

```ts
const brandLogoUrl = `${import.meta.env.BASE_URL}rainbow-interior-logo.svg`;
```

Use `brandLogoUrl` in the brand `<img>`.

- [ ] **Step 3: 只在帳本移除頁面標題**

Render `.page-heading` only when `view !== "cashflow"`.

- [ ] **Step 4: 將摘要與新增合併**

Move `cashbook-create-toggle` and its menu inside the summary container after the four metric cards. Keep existing IDs and actions so behavior remains unchanged.

- [ ] **Step 5: 將三組篩選合併成一列**

Render one `.cashbook-filter-line` containing:

```html
<div class="cashbook-filter-group people">人員頭像</div>
<div class="cashbook-filter-group">類型按鈕</div>
<div class="cashbook-filter-group">分類按鈕</div>
```

Remove visible people names from filter buttons but retain `title` and `aria-label`.

- [ ] **Step 6: 加入響應式樣式**

Desktop summary uses four flexible metric cells plus a fixed create cell. Desktop filters stay one row. Mobile summary and filters use container-level horizontal scrolling with fixed minimum child widths; `html` and body remain overflow-free.

- [ ] **Step 7: 建置檢查**

Run: `npm.cmd run build`

Expected: SVG URL, TypeScript and CSS build pass.

---

### Task 4: 實作清單／左右模式與手機頁籤

**Files:**
- Modify: `web/src/cashbook-page.ts`
- Modify: `web/src/cashbook-page.css`
- Modify: `web/src/cashbook-minimal.css`
- Modify: `web/src/main.ts`
- Test: `web/src/cashbook-layout.test.ts`

**Interfaces:**
- Consumes: `partitionCashbookActivities`, `CashbookViewMode`, current filtered and sorted activities.
- Produces: mode toggle, desktop split columns, mobile income/expense panes, full-width transfers.

- [ ] **Step 1: 傳入顯示模式介面**

Extend `CashbookPageOptions` with:

```ts
viewMode: CashbookViewMode;
updateViewMode(mode: CashbookViewMode): void;
```

Pass these from `main.ts`.

- [ ] **Step 2: 加入右上模式切換**

Add two icon buttons to the existing list toolbar:

```html
<button aria-label="清單模式" aria-pressed="true"><i class="ph ph-list"></i></button>
<button aria-label="左右模式" aria-pressed="false"><i class="ph ph-columns"></i></button>
```

Use the matching supported Phosphor classes and add their codepoints to `phosphor-subset.css`.

- [ ] **Step 3: 渲染桌機左右模式**

After filtering and sorting, call `partitionCashbookActivities(activities)`. Render two `.cashbook-split-column` sections for income and expense. Render `.cashbook-transfer-section` across both columns underneath.

- [ ] **Step 4: 渲染手機收入／支出頁籤**

Keep a module-level `CashbookMobilePane` state. The two tab buttons update `aria-selected`; only the chosen income or expense card list is visible. Transfer cards always render below the pane.

- [ ] **Step 5: 共用風琴互動**

All list, split-column, mobile-pane, and transfer rows use the existing `data-cashbook-toggle` listener and shared `openActivityId`, preserving one-open-at-a-time behavior.

- [ ] **Step 6: 加入模式樣式**

Desktop uses a two-column grid with equal tracks and consistent headers. Under 760px, hide desktop split tables and display the mobile tabs and cards. Empty states remain one line.

- [ ] **Step 7: 跑完整測試與建置**

Run:

```powershell
npm.cmd test
npm.cmd run build
git diff --check
```

Expected: all commands exit 0.

---

### Task 5: 瀏覽器 QA、提交與部署

**Files:**
- Modify: `design-qa.md`
- Add: updated QA screenshots and comparisons.

**Interfaces:**
- Consumes: local Vite preview and user screenshots.
- Produces: browser evidence, passing QA, commit, push, successful GitHub Actions deployment.

- [ ] **Step 1: 驗證桌機**

Check full brand SVG, hidden ledger heading, five-segment summary, far-right create menu, single filter line, list/split switching, split transfer section, search, sort and accordion.

- [ ] **Step 2: 驗證 320px**

Check no page-level horizontal overflow, internal summary/filter scrolling, avatar-only people, income/expense tabs, transfer section, and readable amounts.

- [ ] **Step 3: 合併視覺比較**

Create combined comparison images from the supplied screenshots and matching implementation captures. Fix every P0/P1/P2 issue and repeat the comparison.

- [ ] **Step 4: 更新 QA**

Record source paths, implementation paths, dimensions, interactions, console status, comparison history and exact `final result: passed`.

- [ ] **Step 5: 最終驗證**

Run:

```powershell
npm.cmd test
npm.cmd run build
git diff --check
git status --short
```

- [ ] **Step 6: Commit 與 push**

```powershell
git add -- web/src/cashbook-layout.ts web/src/cashbook-layout.test.ts web/src/filter-cache.ts web/src/filter-cache.test.ts web/src/main.ts web/src/style.css web/src/cashbook-page.ts web/src/cashbook-page.css web/src/cashbook-minimal.css web/src/phosphor-subset.css web/public/rainbow-interior-logo.svg design-qa.md docs/superpowers/plans/2026-07-30-ledger-compact-split-mode.md qa-*.png qa-*.jpg
git commit -m "feat: 新增帳本左右模式並壓縮版面 #1069"
git push origin main
```

- [ ] **Step 7: 追蹤部署**

Wait for the `Test and deploy renovation budget` GitHub Actions run for the new commit. Confirm `test`, `deploy-worker`, and `deploy-pages` all succeed, then verify the production GitHub Pages URL returns HTTP 200.
