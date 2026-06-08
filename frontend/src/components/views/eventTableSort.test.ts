import { describe, it, expect } from "vitest";
import {
  sortEventRecords,
  nextSortState,
  type EventTableSort,
} from "./eventTableSort";

type Rec = Record<string, unknown>;

const rows: Rec[] = [
  { id: "a", peak_z: 3.2, label: "ripple" },
  { id: "b", peak_z: 1.1, label: "spindle" },
  { id: "c", peak_z: 8.0, label: "ripple" },
  { id: "d", peak_z: 1.1, label: "burst" }, // tie on peak_z with b
];

function ids(recs: Rec[]): string[] {
  return recs.map((r) => String(r.id));
}

describe("sortEventRecords", () => {
  it("returns a copy in input order when column is null", () => {
    const out = sortEventRecords(rows, { column: null, direction: "asc" });
    expect(ids(out)).toEqual(["a", "b", "c", "d"]);
    expect(out).not.toBe(rows); // new array
  });

  it("sorts a numeric column ascending", () => {
    const out = sortEventRecords(rows, { column: "peak_z", direction: "asc" });
    expect(ids(out)).toEqual(["b", "d", "a", "c"]);
  });

  it("sorts a numeric column descending", () => {
    const out = sortEventRecords(rows, { column: "peak_z", direction: "desc" });
    expect(ids(out)).toEqual(["c", "a", "b", "d"]);
  });

  it("is stable on ties (preserves input order among equal keys)", () => {
    // b and d both have peak_z 1.1; b precedes d in input, so b stays first.
    const asc = sortEventRecords(rows, { column: "peak_z", direction: "asc" });
    expect(asc.slice(0, 2).map((r) => r.id)).toEqual(["b", "d"]);
    // Descending keeps the same relative order among the tied pair (stable).
    const desc = sortEventRecords(rows, { column: "peak_z", direction: "desc" });
    expect(desc.slice(2).map((r) => r.id)).toEqual(["b", "d"]);
  });

  it("sorts a string column", () => {
    const asc = sortEventRecords(rows, { column: "label", direction: "asc" });
    expect(ids(asc)).toEqual(["d", "a", "c", "b"]); // burst, ripple, ripple, spindle
    // ripple ties (a,c) keep input order.
    expect(asc[1].id).toBe("a");
    expect(asc[2].id).toBe("c");
  });

  it("coerces numeric strings to numbers", () => {
    const r: Rec[] = [{ id: "x", v: "10" }, { id: "y", v: "9" }, { id: "z", v: "100" }];
    const out = sortEventRecords(r, { column: "v", direction: "asc" });
    expect(ids(out)).toEqual(["y", "x", "z"]); // 9 < 10 < 100 (not lexical)
  });

  it("sorts blank/missing cells to the end in both directions", () => {
    const r: Rec[] = [
      { id: "a", v: 2 },
      { id: "b" }, // missing v
      { id: "c", v: 1 },
      { id: "d", v: "" }, // blank v
    ];
    const asc = sortEventRecords(r, { column: "v", direction: "asc" });
    expect(asc.slice(0, 2).map((x) => x.id)).toEqual(["c", "a"]);
    expect(asc.slice(2).map((x) => x.id)).toEqual(["b", "d"]); // blanks last
    const desc = sortEventRecords(r, { column: "v", direction: "desc" });
    expect(desc.slice(0, 2).map((x) => x.id)).toEqual(["a", "c"]);
    expect(desc.slice(2).map((x) => x.id)).toEqual(["b", "d"]); // blanks still last
  });

  it("does not mutate the input array", () => {
    const copy = rows.slice();
    sortEventRecords(rows, { column: "peak_z", direction: "desc" });
    expect(rows).toEqual(copy);
  });
});

describe("nextSortState", () => {
  const none: EventTableSort = { column: null, direction: "asc" };

  it("starts a new column ascending", () => {
    expect(nextSortState(none, "peak_z")).toEqual({ column: "peak_z", direction: "asc" });
  });

  it("flips asc → desc on the same column", () => {
    expect(nextSortState({ column: "peak_z", direction: "asc" }, "peak_z")).toEqual({
      column: "peak_z",
      direction: "desc",
    });
  });

  it("clears the sort on the third click (desc → none)", () => {
    expect(nextSortState({ column: "peak_z", direction: "desc" }, "peak_z")).toEqual({
      column: null,
      direction: "asc",
    });
  });

  it("switching to a different column resets to ascending", () => {
    expect(nextSortState({ column: "peak_z", direction: "desc" }, "label")).toEqual({
      column: "label",
      direction: "asc",
    });
  });
});
