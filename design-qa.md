# #1069 帳本極簡版設計 QA

## 比對目標

- Source visual truth:
  - `C:/Users/Danny/AppData/Local/Temp/codex-clipboard-3c92f878-5699-4ae9-80e7-3d8a133af8f2.png`（清單密度與四欄資訊）
  - `C:/Users/Danny/AppData/Local/Temp/codex-clipboard-f00fc5dc-f726-4d91-a572-4d43bec52d09.png`（篩選控制）
  - 本任務最新文字規格（人員僅顯示頭像、三組篩選同列、摘要五段、左右模式與全寬轉移）
- Rendered implementation:
  - `design-qa-artifacts/ledger-desktop-list.png`
  - `design-qa-artifacts/ledger-desktop-split-fixed.png`
  - `design-qa-artifacts/ledger-mobile-320-split.png`
  - `design-qa-artifacts/ledger-mobile-320-list.png`
- Combined comparison evidence:
  - `design-qa-artifacts/compare-desktop-source-implementation.png`
  - `design-qa-artifacts/compare-filter-source-implementation.png`

## 正規化資訊

- 桌機來源清單：1293 × 392 px，96 dpi；比對圖等比例縮至 855 px 寬。
- 桌機實作：CSS viewport 855 × 830，截圖 855 × 830 px，device scale factor 1。
- 手機實作：CSS viewport 320 × 720；分欄截圖 320 × 720 px，清單 full-page 截圖 320 × 830 px，device scale factor 1。
- 篩選來源：672 × 125 px；focused comparison 依共同寬度等比例置入，未以密度差異判斷字體或間距。
- 來源截圖是舊版局部畫面，不含新的摘要與左右模式；此部分以使用者最新文字規格作為視覺真值。

## 狀態與互動

- Desktop list：全部人員／全部類型／全部分類，日期新到舊。
- Desktop split：收入左、支出右、轉移下方全寬。
- Mobile split：收入／支出頁籤，轉移固定在下方；實測切換至支出後內容更新。
- Mobile list：Danny 人員篩選、清單模式、單筆風琴展開。
- 已測試：新增選單開啟、`Esc` 關閉與焦點回復、模式切換、模式在篩選重繪後保留、人員篩選、頁籤、單筆風琴、tooltip/aria 姓名、摘要與篩選內部橫向滑動。
- Console error/warning：0。

## Required fidelity surfaces

- Fonts and typography：沿用現有介面字體與字重；摘要數字桌機為 26px、tabular numerals；品牌 SVG 具中文與英文標準字及完整 fallback。
- Spacing and layout rhythm：移除帳本標題後，摘要成為首個內容區；五段摘要、單列篩選與工具列間距一致。桌機左右兩欄等寬，轉移跨兩欄。
- Colors and visual tokens：選取狀態維持深綠底白字；收入綠、支出橘紅、轉移藍；摘要、分組標頭與既有色票一致。
- Image quality and asset fidelity：品牌使用獨立向量檔並以 `BASE_URL` 載入；自然尺寸 300 × 56，可在 GitHub Pages 子路徑正常解析。動畫與 `prefers-reduced-motion` 均已定義。此為使用者明確要求的新動畫漸層 SVG，來源畫面原圖本身是破圖，並無可保留的既有品牌原稿。
- Copy and content：帳本標題已移除；人員篩選不顯示姓名；「工程款轉移」使用「款項交接」；金額使用 `＋`、`−`、`↔` 且無 `$`。

## Findings

- 無剩餘 P0／P1／P2。
- P3：320px 頂部導覽為內部橫向捲動，最窄畫面不會同時露出四個導覽圖示；這是保留完整品牌標準字及既有頂部操作按鈕後的可接受取捨，整頁不會水平溢出。

## Comparison history

### Iteration 1

- [P2] Desktop split 的轉移列人員欄與日期欄重疊。
  - Evidence：人員內容 `scrollWidth 84px`，欄寬僅 `72px`，量測 `overlap: true`；截圖為 `ledger-desktop-split.png`。
  - Root cause：收入／支出單頭像與轉移雙頭像共用同一個 72px grid track。
  - Fix：桌機人員欄調整為 90px，390px 以下調整為 80px。
  - Post-fix evidence：人員欄寬與 scrollWidth 皆為 90px，日期左緣晚於人員欄右緣，`overlap: false`；截圖為 `ledger-desktop-split-fixed.png`。

### Iteration 2

- 重新比對完整桌機、單列篩選、320px split/list 與風琴狀態。
- 未發現可操作的 P0／P1／P2 差異。

## Implementation checklist

- [x] 移除帳本標題。
- [x] 完整動畫品牌 SVG 與 GitHub Pages 相對路徑。
- [x] 摘要四數字與 `＋` 同列。
- [x] 人員／類型／分類單列與內部捲動。
- [x] 人員僅顯示首字頭像並保留完整無障礙名稱。
- [x] 清單／左右模式切換與專案快取。
- [x] 手機收入／支出頁籤與全寬轉移。
- [x] 320px 無整頁水平溢出。
- [x] 新增選單、搜尋、排序、風琴與鍵盤互動。

final result: passed
