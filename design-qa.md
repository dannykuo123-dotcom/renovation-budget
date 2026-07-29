# #1069 Single-layer Minimal Ledger Design QA

## Evidence

- Source visual truth:
  - `C:\Users\Danny\AppData\Local\Temp\codex-clipboard-4adb84aa-fbb1-444a-ab58-a67bb24c9485.png`
  - `C:\Users\Danny\AppData\Local\Temp\codex-clipboard-2cdbed54-40ff-4fc6-8afa-210955eebc01.png`
  - `C:\Users\Danny\AppData\Local\Temp\codex-clipboard-ff71e54b-d2c9-4458-a5ae-7ddf1168bd02.png`
  - `C:\Users\Danny\AppData\Local\Temp\codex-clipboard-08116cf4-10f1-4f99-ba67-039e757d0bb3.png`
- Implementation screenshots:
  - `C:\Users\Danny\Desktop\renovation-budget\qa-cashbook-desktop.jpg`
  - `C:\Users\Danny\Desktop\renovation-budget\qa-cashbook-mobile.jpg`
  - `C:\Users\Danny\Desktop\renovation-budget\qa-expense-form.jpg`
  - `C:\Users\Danny\Desktop\renovation-budget\qa-transfer-form.jpg`
- Combined comparison inputs:
  - `C:\Users\Danny\Desktop\renovation-budget\qa-cashbook-comparison.png`
  - `C:\Users\Danny\Desktop\renovation-budget\qa-form-comparison.png`
- Desktop ledger: 1280 × 900 CSS px, device scale factor 1, 1280 × 900 implementation pixels.
- Mobile ledger: 320 × 700 CSS px, device scale factor 1, 320 × 953 full-page implementation pixels.
- Expense form: 720 × 950 CSS px, device scale factor 1, 720 × 950 implementation pixels.
- Source form: 658 × 704 pixels at 96 dpi. It was normalized to 720 px width for the combined comparison.
- Source filter crop: 377 × 203 pixels at 96 dpi. It was normalized to 1200 px width; the matching implementation region was cropped from the 1280 px desktop capture and normalized to the same width.
- State: populated expense ledger, direct filters, search open, accordion open, and fresh transfer form with two active people.

## Full-view comparison evidence

The implementation preserves the source product’s cream, green, gray, rounded-card language while removing the sidebar and replacing it with one glass top bar. The account summary, people-first filters, combined type/category row, icon toolbar, and four-column ledger are visibly denser than the source captures without hiding the core workflow.

The form comparison shows the intended simplification directly: the readonly record-type field and explanatory paragraphs are gone; small-choice dropdowns are replaced by direct chips; the date control has a single branded calendar affordance; upload is a full drop zone; and the single primary action is named “儲存”.

## Focused region comparison evidence

- Filter and ledger region: `qa-cashbook-comparison.png` keeps labels, avatars, selected states, sort/search icons, columns, and amount color legible at a common width.
- Expense form: `qa-form-comparison.png` keeps all source and implementation controls legible at a common width.
- Transfer post-fix evidence: `qa-transfer-form.jpg` visibly shows Danny selected for 轉出 and 浩浩 selected for 轉入.

## Required fidelity surfaces

- Fonts and typography: the existing application font stack is retained. The new brand English line uses small tracked capitals; page headings, chip labels, numeric totals, and compact toolbar text have distinct weights without excess descriptive copy.
- Spacing and layout rhythm: top navigation, summaries, filter deck, toolbar, and table share the same content grid. Desktop uses two compact filter rows; 320 px uses wrapped controls and avatar compression without clipped persistent controls.
- Colors and visual tokens: the existing cream background and deep green active state remain. Active navigation uses a dark surface with white text; expense values remain orange-red and balances green.
- Image quality and asset fidelity: Phosphor’s official icon font supplies interface icons. The requested animated gradient brand mark is an external SVG asset, not an inline or CSS-drawn substitute, and remains sharp at desktop and mobile sizes.
- Copy and content: redundant form explanations, upload format copy, project eyebrow, and “收支明細” are absent. Buttons consistently use “儲存”; filters remain “人員／類型／分類”; the transfer workflow remains clearly named “轉移”.

## Findings

- No actionable P0, P1, or P2 mismatch remains.
- P3: at very short browser heights, the upload zone requires one short modal scroll; the sticky cancel/save bar remains visible and the upload control is not obscured.

## Interaction and responsive checks

- `＋` exposes 支出／收入／轉移 and can be closed by outside click or `Esc`.
- Direct people/category/payment/status controls update their pressed state and submitted hidden value.
- Income status remains implicit; expense exposes only 已付款／待付款; transfer exposes only 已完成／待處理.
- A fresh transfer defaults to two different people and still rejects identical participants.
- Date input opens through the native picker surface with one visible calendar icon.
- Upload drop zone supports click selection, drag-over styling, file count, and the existing file validation.
- Search applies on `Enter`; sort and filter controls rerender correctly.
- Accordion exposes details and edit/delete actions; only one record stays expanded.
- 320 px full-page capture shows no clipped controls or application-level horizontal scrolling.
- Browser console: no errors or warnings.

## Comparison history

1. Initial expense-form capture found the sticky top navigation rendering above the modal and a duplicate native calendar icon.
2. Raised the modal layer above navigation and made the native date indicator invisible while preserving its click target. Post-fix evidence is `qa-expense-form.jpg` and `qa-form-comparison.png`.
3. Initial transfer capture selected the same first person for both directions.
4. Added a tested default-participant helper and repeated the browser pass. `qa-transfer-form.jpg` shows two different selected people.
5. Final desktop, form, and 320 px comparisons found no remaining P0/P1/P2 issue. Browser logs remained clean.

final result: passed
