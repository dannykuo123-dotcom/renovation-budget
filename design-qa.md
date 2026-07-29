# #1069 Design QA

## Evidence

- Source visual truth:
  - `C:\Users\Danny\AppData\Local\Temp\codex-clipboard-7f37707f-c9c6-4cd6-827d-37bd2e98008b.png`
  - `C:\Users\Danny\AppData\Local\Temp\codex-clipboard-c6943b79-a116-441a-8636-7d5faf30ab35.png`
- Implementation screenshots:
  - `C:\tmp\1069-cashbook-desktop.png`
  - `C:\tmp\1069-cashbook-mobile-320.png`
- Combined comparisons:
  - `C:\tmp\1069-design-qa-comparison.png`
  - `C:\tmp\1069-design-qa-mobile-comparison.png`
- Desktop viewport: 1119 × 800 CSS px, device scale factor 1. Full-page implementation capture: 1104 × 835 px. Source capture: 1117 × 512 px.
- Mobile viewport: 320 × 900 CSS px, device scale factor 1. Full-page implementation capture: 320 × 901 px. Source capture: 665 × 881 px, normalized to 320 px width for comparison.
- State: all transaction types, all people, all categories, populated income/expense/transfer records, create menu closed.

## Full-view comparison

The implementation keeps the existing product shell and visual tokens while replacing the dense multi-column ledger with the approved four-field hierarchy. The top-level summary, direct filters, single create button, avatar-only people column, signed color amounts, and compact mobile cards are all visible in the combined evidence.

The large differences from the source screenshots are intentional #1069 simplifications: status filtering and the redundant section title are removed; entry actions and accounting details move into the accordion; people move to the first column; and project transfers become neutral “款項交接” records.

## Focused comparison

A separate crop was not required because the full-width desktop and normalized 320 px comparison keep the summary, filters, people avatars, labels, amount signs, and transaction rows legible. The expanded accordion was additionally inspected in the browser DOM with all requested facts and edit/delete actions visible.

## Required fidelity surfaces

- Fonts and typography: existing application font stack, weights, hierarchy, truncation, and numeric alignment are preserved.
- Spacing and layout rhythm: desktop filters and ledger align to the existing content grid; mobile uses compressed avatars and spacing without horizontal overflow.
- Colors and visual tokens: existing cream, green, gray, and border palette is retained; income is green, expense orange-red, and transfer blue.
- Image and asset fidelity: this ledger contains no source imagery or custom raster assets. Person identities use semantic text initials as specified.
- Copy and content: “款項交接”, “人員”, “全部”, summary labels, signs, pending hints, and accordion accounting explanations match the approved requirements.

## Findings

- No actionable P0, P1, or P2 visual mismatch remains.
- P3 follow-up: the compact search glyph could be replaced by the product's eventual shared icon set when one is introduced.

## Interaction and responsive checks

- `＋` menu opens and exposes 支出／收入／轉移, closes with `Esc`, and closes after an outside click.
- Search applies on `Enter`; date sorting and direct type/person/category filters rerender correctly.
- A transfer is found through either participant while project summary totals remain unchanged.
- Category filtering returns only matching expenses.
- Only one accordion row remains expanded at a time.
- Desktop and 320 px mobile render without horizontal overflow.
- Browser console: no errors or warnings.

## Comparison history

1. Initial browser pass found that pressing `Enter` in search did not apply the query.
2. Added explicit Enter handling and repeated the browser test with two records; “塑膠門” reduced the ledger from two rows to one.
3. The interaction-only fix did not alter layout or visual styling; final browser console remained clean.

final result: passed
