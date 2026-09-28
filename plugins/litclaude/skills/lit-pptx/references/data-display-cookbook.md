# Data Display Cookbook

Standardizes numbers, tables, and KPI tiles. Colors below refer to the chosen template's palette roles, not fixed brand hex.

## Number display
| Data type | Preferred | Avoid |
|-----------|-----------|-------|
| Year | `2026`, `2026E`, `2027F` | `2,026` |
| Percentage | `12.3%` | `0.123` |
| Multiple | `3.2x` | `3.2 times` |
| Zero / N/A | `-` | `0.0` when it means N/A |
| Currency header | `매출 (억원)` / `Revenue (USD m)` | repeating the unit in each row |

## Table patterns

### 1. Compact operational table (4–6 columns of operational data)
- Body and bold header in the template's table sizes; tight row padding; light bottom rules only. Use right-aligned numbers in quantitative columns.

### 2. Comparison matrix (alternatives / vendors / scenarios)
- Alternating row bands; strong header row; one emphasis column only; right-align all quantitative columns.

### 3. KPI strip (3–4 headline numbers before a narrative/chart)
- Value on top, label below; primary value in the template's metric color; positive/negative only for deltas (with ▲/▼ glyph); center within each tile.

## Source-note pattern
Place source text under the table/chart, smaller than body text:
- `Source: ERP export, 2026-04-14, Procurement`
- `출처: 내부 운항 데이터, 2026.04 기준`
- `Source: Clarkson Research, 2026-04, LNG orderbook`

## Rules of thumb
- Units in headers, never per cell. Numeric columns right-aligned (the real fix on export).
- ≤ 6 columns; split a wide table rather than shrinking text below the template's minimum body size.
- One emphasis per table; no styled spans inside cells; no rainbow semantics.
- Keep one primary visual emphasis. Do not highlight a row, a column, and several cells at the same time.
- Avoid chart-type mixing unless a clear analytical reason requires it; state that reason in the interpretation.
- Keep labels readable at presentation scale and move or abbreviate collision-prone labels. Axis labels, data labels, annotations, and legends must not overlap.
- A dense table uses the same bounds: units in headers, right-aligned numbers, ≤6 columns, no text below the template floor, and no collision with an adjacent image.

## Evidence display patterns

- **figure plus interpretation:** one figure, numbered caption, source locator, limitation, and a concise interpretation placed as one visual group.
- **table plus decision takeaway:** one bounded table, caption/source, and one decision sentence. Do not duplicate the table in prose.
- **source capture:** crop to the relevant region while retaining enough interface/document context to verify the locator.
- **two-record appendix evidence:** at most two records per slide. Each record includes summary, source/locator, and DOI/canonical link when available.
