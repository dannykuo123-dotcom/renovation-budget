# Design QA — #1069 屋主預算與分類卡片

## Visual truth

- 原始畫面：`design-qa-artifacts/budget-source-before.png`
- 原始畫面是六欄財務表；本次依已確認規格改成「屋主預算上限＋分類卡片」，不是逐像素複製。

## Implementation captures

- 桌機：`design-qa-artifacts/budget-owner-desktop-1440.png`
- 桌機 viewport：1440 × 900 px。
- 手機：`design-qa-artifacts/budget-owner-mobile-320.png`
- 手機 viewport：320 × 800 px。

## Information model

- 屋主預算：專案層級的手動上限，可隨時編輯，帳本同步顯示同一數值。
- 目前工程預算：所有預算項目的 `數量 × 單價` 加總。
- 已支出：只計入帳本中已入帳的支出。
- 可用餘額：屋主預算減已支出。
- 預估差額：屋主預算減目前工程預算，以摘要次要文字呈現。
- 預算項目依分類顯示卡片；空分類仍保留快速新增入口，舊有未分類項目顯示「待分類」。

## Interaction verification

- 驗證屋主預算編輯後預算摘要即時更新，帳本摘要同步顯示相同數值。
- 驗證分類建立、分類卡片空狀態、卡片內快速新增、數量 × 單價與小計。
- 驗證項目列可點擊編輯，減號可快速刪除，刪除後提供復原操作。
- 驗證「清空目前工程預算」只清除目前工程的項目，保留屋主預算、分類、帳本與其他工程。
- 驗證 1440 px 與 320 px 皆無文件層級水平溢出。
- 驗證按鈕 accessible name、鍵盤 focus 樣式、Esc 關閉新增選單。
- 瀏覽器 console 無 warning 或 error。

## Visual review

- 摘要使用四個等權核心數字與最右側新增按鈕，屋主預算提供輕量鉛筆入口。
- 分類卡片標題只保留名稱、項目數、目前預算、已支出與快速新增，避免報表感。
- 桌機保留數量、單價、小計；手機將數量 × 單價降為次要資訊並固定維持單頁寬度。
- 主要選取色沿用深綠，支出與超額才使用警示紅，沒有額外分類色點。

final result: passed
