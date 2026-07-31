# Design QA — #1069 空間預算極簡改版

## Visual truth

- Source: `design-qa-artifacts/budget-source-before.png`
- Source viewport: 1302 × 582 px, 1× density.
- The source is the existing dense six-column budget table. This implementation intentionally redesigns it to the approved single-layer, space-first layout rather than pixel-cloning it.

## Implementation captures

- Desktop: `design-qa-artifacts/budget-desktop-1440.png`
- Desktop viewport: 1440 × 900 px, 1× density.
- Mobile: `design-qa-artifacts/budget-mobile-320.png`
- Mobile viewport: 320 × 800 px, 1× density.
- Combined comparison: `design-qa-artifacts/budget-source-comparison.png`.

## Full-view comparison

- The large title, explanation, colored category dots, sorting arrows, utilization column, and six-column report table are removed.
- The top region is reduced to one summary row with total budget, actual expense, remaining budget, and the add button.
- Space and category controls share one horizontally scrollable filter row; at 320 px only that row scrolls and the document width remains 320 px.
- The content is grouped into compact space accordions. Desktop displays item, quantity, unit price, and subtotal; mobile displays item and subtotal with quantity/unit price as secondary copy.

## Focused surfaces

- Typography: reuses the product font stack; large tabular numerals improve scanability without introducing a competing type family.
- Spacing: summary, filters, and accordion use the existing compact radius and spacing system; mobile padding is reduced without touching the viewport edges.
- Colors: the approved dark green remains the selected/primary color; expense red is limited to actual expense and destructive actions.
- Assets: no decorative image assets are required on this functional budget screen.
- Copy: labels are reduced to short operational terms; all save actions use `儲存`.

## Interaction verification

- Verified add menu and the new item, space, and category flows.
- Verified live `quantity × unit price` subtotal and project total recomputation.
- Verified combined space/category filtering, empty state, accordion opening, item editing, and focus-visible treatment.
- Verified exact accessible names after replacing nested labels with semantic field containers.
- Verified the 1440 px and 320 px layouts, including no document-level horizontal overflow.
- Browser console produced no warnings or errors during the tested flow.

## Comparison history

1. First browser pass found P2 confused accessible names caused by interactive buttons nested inside labels.
2. Replaced those wrappers with semantic `.form-field` containers and rechecked the accessibility snapshot.
3. Final desktop/mobile captures show no actionable P0, P1, or P2 visual issues.

final result: passed