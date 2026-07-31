# 屋主預算與分類卡片 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將預算頁改成以屋主預算為控制上限、以分類卡片快速規劃工程項目，並讓帳本摘要同步顯示同一筆屋主預算。

**Architecture:** 在 `projects` 增加專案層級的 `owner_budget`，預算項目仍沿用既有 `BudgetSpace` 與 `BudgetItem` 資料模型，但畫面不再暴露空間層級。前端以純函式計算屋主預算、目前工程預算、已支出、可用餘額與預估差額，再將項目依帳本分類組成卡片。清空功能只刪除指定工程的預算項目，不動屋主預算、帳本、分類或其他工程。

**Tech Stack:** TypeScript、Vite、Cloudflare Workers、D1/SQLite、Node test runner、CSS、GitHub Pages

## Global Constraints

- 不自動清除既有資料；只提供使用者主動確認的「清空目前工程預算」。
- 不刪除 `BudgetSpace` 資料或 API；新增項目自動使用第一個／預設空間，以保持舊資料相容。
- 帳本收入、支出、轉移與附件資料模型不變。
- 所有金額以非負安全整數儲存，畫面不顯示 `$`。
- 桌機與手機不得產生整頁水平捲動；卡片內資訊在 320px 寬度仍可讀。
- 每個功能先寫失敗測試，再完成最小實作，最後執行完整測試與建置。

---

## Task 1: 新增專案屋主預算欄位與 API

**Files:**

- Create: `worker/migrations/0011_owner_budget.sql`
- Modify: `worker/src/index.ts`
- Modify: `web/src/types.ts`
- Modify: `web/src/api.ts`
- Create: `web/src/owner-budget-migration.test.js`

- [ ] **Step 1: 撰寫 migration 失敗測試**

在 `web/src/owner-budget-migration.test.js` 使用 `node:sqlite` 依序執行 `0001` 至 `0011`，建立兩個工程並驗證：

```js
assert.equal(project.owner_budget, 0);
assert.equal(existingBudgetItemCount, 1);
assert.equal(existingLedgerCount, 1);
```

同時確認 migration 前的工程、預算項目與帳本資料都保留。

- [ ] **Step 2: 執行測試確認 RED**

Run: `npm.cmd test -- --runInBand`

Expected: FAIL，因為 `0011_owner_budget.sql` 尚不存在或 `owner_budget` 欄位不存在。

- [ ] **Step 3: 新增 migration**

`worker/migrations/0011_owner_budget.sql`：

```sql
ALTER TABLE projects
ADD COLUMN owner_budget INTEGER NOT NULL DEFAULT 0 CHECK (owner_budget >= 0);
```

- [ ] **Step 4: 更新共享型別與 mapping**

在 `web/src/types.ts` 的 `Project` 加入：

```ts
ownerBudget: number;
```

在 `worker/src/index.ts` 的 `mapProject()` 加入：

```ts
ownerBudget: Number(row.owner_budget ?? 0),
```

在 `web/src/api.ts` 的 demo 工程資料加入 `ownerBudget: 0`，確保 `ProjectSummary` 與 dashboard 都繼承相同欄位。

- [ ] **Step 5: 新增屋主預算 endpoint**

在 Worker 定義上限與驗證：

```ts
const MAX_OWNER_BUDGET = 1_000_000_000_000;

function parseOwnerBudget(value: unknown): number | null {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 && amount <= MAX_OWNER_BUDGET ? amount : null;
}
```

新增 `PATCH /api/projects/:projectId/owner-budget`，body 為：

```ts
{ ownerBudget: number }
```

成功時更新 `projects.owner_budget` 與 `updated_at`，回傳完整 `Project`；錯誤數值回傳 400，不存在工程回傳 404。

- [ ] **Step 6: 新增前端 API**

在 `web/src/api.ts` 新增：

```ts
export async function saveOwnerBudget(projectId: string, ownerBudget: number): Promise<Project>
```

正式模式呼叫 `PATCH /projects/${projectId}/owner-budget`；demo 模式只更新該工程的 `ownerBudget`，不改預算項目與帳本。

- [ ] **Step 7: 驗證 GREEN**

Run: `npm.cmd test`

Expected: migration 與既有測試全部通過。

---

## Task 2: 建立預算摘要與分類卡片純邏輯

**Files:**

- Create: `web/src/budget-category-view.ts`
- Create: `web/src/budget-category-view.test.ts`
- Delete after replacement: `web/src/budget-view.ts`
- Delete after replacement: `web/src/budget-view.test.ts`

- [ ] **Step 1: 先寫摘要計算測試**

建立測試資料：屋主預算 `600000`、目前工程預算 `450000`、已入帳支出 `120000`，驗證：

```ts
assert.deepEqual(calculateBudgetOverview(600000, spaces, entries), {
  ownerBudget: 600000,
  currentBudget: 450000,
  spent: 120000,
  available: 480000,
  estimateGap: 150000,
});
```

並驗證待處理、收入、轉移與作廢紀錄不計入 `spent`。

- [ ] **Step 2: 先寫分類卡片測試**

測試以下邊界：

- 所有啟用分類即使沒有項目仍產生卡片。
- 項目依 `categoryId` 放進正確卡片，不依空間分組。
- 沒有分類的舊項目只在需要時產生「待分類」卡片。
- `planned` 是項目小計總和。
- `spent` 只計入相同 `categoryId` 的已入帳支出。
- 分類卡片依 `sortOrder` 排序。

- [ ] **Step 3: 執行測試確認 RED**

Run: `npm.cmd test -- web/src/budget-category-view.test.ts`

Expected: FAIL，模組與函式尚不存在。

- [ ] **Step 4: 完成純函式**

在 `web/src/budget-category-view.ts` 定義：

```ts
export interface BudgetOverview {
  ownerBudget: number;
  currentBudget: number;
  spent: number;
  available: number;
  estimateGap: number;
}

export interface BudgetCategoryCard {
  id: string | null;
  name: string;
  items: BudgetItem[];
  planned: number;
  spent: number;
}

export function calculateBudgetOverview(
  ownerBudget: number,
  spaces: BudgetSpace[],
  entries: LedgerEntry[],
): BudgetOverview;

export function buildBudgetCategoryCards(
  categories: Category[],
  spaces: BudgetSpace[],
  entries: LedgerEntry[],
): BudgetCategoryCard[];

export function defaultBudgetSpace(spaces: BudgetSpace[]): BudgetSpace | undefined;
```

`calculateBudgetOverview()` 重用 `calculateTotals()`；`buildBudgetCategoryCards()` 將所有 space 的 items 攤平後依分類整理；`defaultBudgetSpace()` 優先 `sortOrder` 最小的空間。

- [ ] **Step 5: 驗證 GREEN 並移除舊 helper**

Run: `npm.cmd test -- web/src/budget-category-view.test.ts`

Expected: PASS。

確認 `main.ts` 已改用新 helper 後，才移除 `budget-view.ts` 與其測試，避免中途破壞建置。

---

## Task 3: 預算頁改為屋主預算摘要與分類卡片

**Files:**

- Modify: `web/src/main.ts`
- Modify: `web/src/budget-minimal.css`
- Modify: `web/src/cashbook-page.ts`
- Modify: `web/src/api.ts`

- [ ] **Step 1: 移除預算頁空間／分類篩選狀態**

從 `main.ts` 移除 `budgetSpaceId`、`budgetCategoryId`、`budgetExpandedSpaceId` 以及對應 cache 讀寫與事件綁定。空間仍存在資料層，但不再顯示「空間／全部／未分空間」。

- [ ] **Step 2: 重寫預算摘要**

`renderBudget()` 使用 `calculateBudgetOverview()`，畫面固定為：

```text
屋主預算（可編輯）｜目前工程預算｜已支出｜可用餘額｜＋
                    預估差額（次要文字）
```

規則：

- 屋主預算 = `payload.project.ownerBudget`
- 目前工程預算 = 預算項目小計總和
- 已支出 = 已入帳支出
- 可用餘額 = 屋主預算 − 已支出
- 預估差額 = 屋主預算 − 目前工程預算

負數以警示色呈現，所有數字使用既有無貨幣符號 formatter。

- [ ] **Step 3: 建立屋主預算編輯 modal**

新增 `openOwnerBudgetModal()`，只有「屋主預算」數字輸入與「儲存」按鈕。儲存呼叫 `saveOwnerBudget()`，更新 payload 後重新渲染預算頁；帳本頁重新載入時讀同一欄位。

- [ ] **Step 4: 將帳本預算同步為屋主預算**

在 `cashbook-page.ts` 將摘要第一格由 `totals.planned` 改成：

```ts
<small>屋主預算</small>
<strong>${formatCashbookNumber(payload.project.ownerBudget)}</strong>
```

其他收入、支出、餘額算法維持不變。

- [ ] **Step 5: 將預算主區改為分類卡片**

每張卡片顯示：

```text
分類名稱  n 項              目前預算  已支出  ＋ 項目
項目名稱       數量 × 單價                    小計  −
```

卡片規則：

- 空分類仍顯示精簡空狀態與 `＋ 項目`。
- 項目列點擊或 Enter/Space 開啟編輯。
- `＋ 項目` 開啟表單並預選該分類。
- hover 與 `:focus-visible` 使用淡綠底與明確外框。
- 桌機顯示數量、單價、小計；手機主列只留項目與小計，數量 × 單價放次要文字。

- [ ] **Step 6: 簡化新增項目表單**

將 `openBudgetItemModal(existing?, defaultCategoryId?)` 改為不顯示空間按鈕。提交資料的 `spaceId`：

```ts
existing?.spaceId ?? defaultBudgetSpace(payload.spaces)?.id
```

分類採圓角按鈕；數量預設 `1`；單價輸入即時計算只讀小計；儲存按鈕統一為「儲存」。

- [ ] **Step 7: 簡化全域新增選單**

預算頁 `＋` 選單只保留：

- 新增項目
- 管理分類
- 清空目前工程預算

移除「增加空間」。

- [ ] **Step 8: 完成響應式 CSS**

在 `budget-minimal.css`：

- 摘要數字桌機約 26–30px，最右側 `＋` 與摘要同排。
- 分類卡片使用低對比邊框、充足留白與一致圓角。
- 320px 改為兩欄資訊節奏，但不讓 `body` 或主頁水平溢出。
- 項目操作只在 hover/focus 強化，不依賴 hover 才能操作。
- 尊重既有 `prefers-reduced-motion`。

- [ ] **Step 9: 執行測試與建置**

Run: `npm.cmd test`

Run: `npm.cmd run build`

Expected: 全部 PASS，TypeScript 無錯誤。

---

## Task 4: 快速刪除、復原與專案範圍清空

**Files:**

- Modify: `worker/src/index.ts`
- Modify: `web/src/api.ts`
- Modify: `web/src/main.ts`
- Create: `web/src/api-budget.test.ts`

- [ ] **Step 1: 先寫 API 安全範圍測試**

使用 demo API 建立兩個工程、分類與項目，執行 `clearBudgetItems(projectA.id)` 後驗證：

```ts
assert.equal(projectAAfter.spaces.flatMap((space) => space.items).length, 0);
assert.equal(projectAAfter.project.ownerBudget, originalOwnerBudget);
assert.equal(projectAAfter.categories.length, originalCategoryCount);
assert.equal(projectAAfter.entries.length, originalLedgerCount);
assert.equal(projectBAfter.spaces.flatMap((space) => space.items).length, originalOtherProjectItemCount);
```

- [ ] **Step 2: 執行測試確認 RED**

Run: `npm.cmd test -- web/src/api-budget.test.ts`

Expected: FAIL，`clearBudgetItems` 尚不存在。

- [ ] **Step 3: 完成專案範圍清空 API**

在 `web/src/api.ts` 新增：

```ts
export async function clearBudgetItems(projectId: string): Promise<void>
```

正式模式對 `/projects/${projectId}/budget-items` 發送 `DELETE`；demo 模式只清空該工程每個 space 的 `items`。

在 Worker `budgetItems()` 的 collection route 支援 `DELETE`：

```sql
DELETE FROM budget_line_items WHERE project_id = ?
```

完成後更新該工程 `updated_at` 並回傳 204。不得刪除 categories、spaces、ledger_entries 或 projects。

- [ ] **Step 4: 加入刪除後復原**

擴充 `toast()` 支援可選 action：

```ts
interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}
```

刪除項目前先保存 `name`、`spaceId`、`categoryId`、`quantity`、`unitPrice`、`sortOrder`；刪除成功顯示「項目已刪除」與「復原」。點擊復原使用 `saveBudgetItem()` 建回相同內容並重新載入。

- [ ] **Step 5: 加入確認式清空**

「清空目前工程預算」顯示明確確認：

```text
只會刪除此工程的預算項目；屋主預算、分類、帳本與其他工程不受影響。確定清空？
```

確認後呼叫 `clearBudgetItems(projectId)`；取消不做任何寫入。

- [ ] **Step 6: 驗證 GREEN**

Run: `npm.cmd test -- web/src/api-budget.test.ts`

Run: `npm.cmd test`

Expected: 範圍隔離與所有回歸測試 PASS。

---

## Task 5: 視覺驗證、文件、提交與部署

**Files:**

- Modify: `design-qa.md`
- Add screenshots under: `design-qa-artifacts/`

- [ ] **Step 1: 完整自動驗證**

Run: `npm.cmd test`

Run: `npm.cmd run build`

Run migration rehearsal against a temporary SQLite database, verifying `0011` can be applied once and existing totals are unchanged。

- [ ] **Step 2: 瀏覽器桌機驗證**

在本機頁面檢查：

- 屋主預算編輯後預算頁立即更新。
- 切到帳本後顯示相同屋主預算。
- 每個分類卡片可新增與編輯項目。
- 項目可快速刪除並復原。
- 清空取消時不變；確認時只清空目前工程項目。
- hover、focus、Enter、Space、Esc 行為正確。
- console 無 error。

- [ ] **Step 3: 320px 與手機驗證**

確認摘要、分類卡片、項目表單、toast 與確認 dialog 不超出 viewport；`document.documentElement.scrollWidth === document.documentElement.clientWidth`。

- [ ] **Step 4: 更新 QA 文件與比較圖**

在 `design-qa.md` 記錄屋主預算同步、分類卡片、快速增減、清空安全範圍與桌機／手機驗證結果；保存對應畫面到 `design-qa-artifacts/`。

- [ ] **Step 5: 請求唯讀程式碼審查並修正高風險問題**

使用 `superpowers:requesting-code-review` 檢查 schema、API 權限與範圍、資料保留、鍵盤操作和行動版溢出。對確認成立的問題先補測試再修正。

- [ ] **Step 6: 最終驗證與提交**

Run: `git diff --check`

Run: `npm.cmd test`

Run: `npm.cmd run build`

只 stage 本次相關檔案並提交：

```text
feat: 同步屋主預算與分類卡片 #1069
```

- [ ] **Step 7: 推送與部署**

將目前 `main` 推送至 `origin`，不建立 PR。監看 GitHub Actions / GitHub Pages 部署完成，再到正式網站驗證屋主預算同步、分類卡片與清空操作。
