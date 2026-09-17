/**
 * eventTableSort — pure, testable sort for the event table.
 *
 * The event table shows free-form `record: Record<string, unknown>` rows. A
 * click on a column header sorts the visible rows by that column. This module
 * holds the comparison/sort logic so it can be unit-tested without rendering
 * (jsdom can't render the canvas-heavy workspace, and the table itself is React
 * state — the sort math is the part worth covering).
 *
 * Design notes:
 *   - Sorting is STABLE: equal keys preserve input order (so a second sort key,
 *     or the natural detection order, survives ties). We achieve this by sorting
 *     an index array and breaking ties on the original index.
 *   - Mixed/blank cells sort to the END regardless of direction (a missing
 *     `peak_z` shouldn't masquerade as the smallest value and steal the top of
 *     an ascending sort, nor the bottom of a descending one).
 *   - Numeric columns compare numerically; everything else compares as strings
 *     (locale-naive `<`/`>` — deterministic and dependency-free).
 *
 * This subsumes a "TopN" affordance: sort descending by the score column and
 * read the first N rows.
 */

export type SortDirection = "asc" | "desc";

export type EventTableSort = {
  /** Column key to sort by, or null for the table's natural (input) order. */
  column: string | null;
  direction: SortDirection;
};

/** A null/blank cell — sorts to the end in both directions. */
function isBlank(v: unknown): boolean {
  return v == null || v === "";
}

/**
 * Coerce a cell to a finite number, or `null` if it isn't numeric. Mirrors the
 * project convention (`parseFloat` + `Number.isFinite`, never `as number`).
 */
function asNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Compare two cells for the given column. Returns the ascending-order ordering
 * (negative if a<b); the caller flips for descending. Blanks always sort last
 * (so the sign is computed pre-flip and the caller must NOT flip blank order —
 * see `sortEventRecords`, which handles blanks before applying direction).
 */
function compareCells(a: unknown, b: unknown): number {
  const an = asNumber(a);
  const bn = asNumber(b);
  if (an !== null && bn !== null) {
    return an - bn;
  }
  // String compare (one or both non-numeric).
  const as = String(a ?? "");
  const bs = String(b ?? "");
  if (as < bs) return -1;
  if (as > bs) return 1;
  return 0;
}

/**
 * Return a NEW array of records sorted by `sort`. Pure — does not mutate the
 * input. When `sort.column` is null the input order is returned unchanged
 * (a fresh copy). Stable; blanks sort to the end in both directions.
 *
 * `records` are the raw event records (each a `Record<string, unknown>`), i.e.
 * `EventRecordDTO.record`. The table passes these straight in.
 */
export function sortEventRecords<T extends Record<string, unknown>>(
  records: readonly T[],
  sort: EventTableSort,
): T[] {
  const out = records.slice();
  if (!sort.column) return out;
  const col = sort.column;
  const dir = sort.direction === "desc" ? -1 : 1;

  // Decorate with original index for stability, then sort.
  const decorated = out.map((rec, idx) => ({ rec, idx }));
  decorated.sort((x, y) => {
    const xv = x.rec[col];
    const yv = y.rec[col];
    const xBlank = isBlank(xv);
    const yBlank = isBlank(yv);
    // Blanks always last, regardless of direction.
    if (xBlank && yBlank) return x.idx - y.idx;
    if (xBlank) return 1;
    if (yBlank) return -1;
    const cmp = compareCells(xv, yv);
    if (cmp !== 0) return dir * cmp;
    // Stable tie-break on original order.
    return x.idx - y.idx;
  });
  return decorated.map((d) => d.rec);
}

/**
 * Toggle the sort state for a header click. Clicking a new column starts at
 * ascending; clicking the active column flips its direction. Clicking the
 * active column while descending clears the sort (back to natural order) so
 * three clicks cycle asc → desc → none.
 */
export function nextSortState(
  current: EventTableSort,
  column: string,
): EventTableSort {
  if (current.column !== column) {
    return { column, direction: "asc" };
  }
  if (current.direction === "asc") {
    return { column, direction: "desc" };
  }
  return { column: null, direction: "asc" };
}
