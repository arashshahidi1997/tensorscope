import { describe, it, expect } from "vitest";
import {
  applyEventFilters,
  resolveEventProperty,
  resolveEventSpan,
} from "./eventFilterLogic";
import type { EventRecordDTO } from "../../api/types";

const rec = (r: Record<string, unknown>): EventRecordDTO => ({ record: r });

const streamMap = (entries: Record<string, Record<string, unknown>[]>) => {
  const m = new Map<string, EventRecordDTO[]>();
  for (const [name, rows] of Object.entries(entries)) m.set(name, rows.map(rec));
  return m;
};

describe("resolveEventProperty", () => {
  it("reads a direct numeric column", () => {
    expect(resolveEventProperty({ amplitude: 42 }, "amplitude")).toBe(42);
  });

  it("coerces numeric strings, rejects non-numeric/NaN", () => {
    expect(resolveEventProperty({ value: "3.5" }, "value")).toBe(3.5);
    expect(resolveEventProperty({ value: "abc" }, "value")).toBeUndefined();
    expect(resolveEventProperty({ value: NaN }, "value")).toBeUndefined();
  });

  it("normalizes peak_z ← value and frequency ← freq/freq_peak", () => {
    expect(resolveEventProperty({ value: 4 }, "peak_z")).toBe(4);
    expect(resolveEventProperty({ freq: 12 }, "frequency")).toBe(12);
    expect(resolveEventProperty({ freq_peak: 150 }, "frequency")).toBe(150);
    // direct key wins over alias
    expect(resolveEventProperty({ peak_z: 9, value: 1 }, "peak_z")).toBe(9);
  });

  it("computes duration from t0/t1 when no duration column", () => {
    expect(resolveEventProperty({ t0: 1.0, t1: 1.3 }, "duration")).toBeCloseTo(0.3);
  });

  it("returns undefined for an absent property", () => {
    expect(resolveEventProperty({ t: 5 }, "amplitude")).toBeUndefined();
  });
});

describe("resolveEventSpan", () => {
  it("uses t0/t1 when present", () => {
    expect(resolveEventSpan({ t0: 2, t1: 2.5 })).toEqual({ t0: 2, t1: 2.5, duration: 0.5 });
  });

  it("falls back to event_start/event_end aliases", () => {
    expect(resolveEventSpan({ event_start: 1, event_end: 1.2 })).toEqual({
      t0: 1,
      t1: 1.2,
      duration: expect.closeTo(0.2),
    });
  });

  it("derives a centred span from duration + t when no explicit bounds", () => {
    const span = resolveEventSpan({ t: 10, duration: 0.4 });
    expect(span?.t0).toBeCloseTo(9.8);
    expect(span?.t1).toBeCloseTo(10.2);
    expect(span?.duration).toBeCloseTo(0.4);
  });

  it("returns undefined for a point event (no span info)", () => {
    expect(resolveEventSpan({ t: 5 })).toBeUndefined();
  });
});

describe("applyEventFilters", () => {
  it("returns the SAME map reference when no filters are active", () => {
    const m = streamMap({ spindle: [{ t: 1, value: 4 }] });
    expect(applyEventFilters(m, {})).toBe(m);
    // a stream key present but with an empty range object also counts as inactive
    expect(applyEventFilters(m, { spindle: {} })).toBe(m);
  });

  it("keeps only records whose property is within the inclusive range", () => {
    const m = streamMap({
      spindle: [{ t: 1, value: 2 }, { t: 2, value: 3 }, { t: 3, value: 5 }, { t: 4, value: 6 }],
    });
    const out = applyEventFilters(m, { spindle: { peak_z: [3, 5] } });
    const vals = out.get("spindle")!.map((r) => r.record.value);
    expect(vals).toEqual([3, 5]); // 2 and 6 excluded; bounds inclusive
  });

  it("applies alias normalization (peak_z ← value, frequency ← freq)", () => {
    const m = streamMap({
      spindle: [{ t: 1, value: 4, freq: 13 }, { t: 2, value: 4, freq: 9 }],
    });
    const out = applyEventFilters(m, { spindle: { frequency: [11, 16] } });
    expect(out.get("spindle")!.map((r) => r.record.t)).toEqual([1]);
  });

  it("excludes records missing the filtered property", () => {
    const m = streamMap({ spindle: [{ t: 1, value: 4 }, { t: 2 /* no value */ }] });
    const out = applyEventFilters(m, { spindle: { peak_z: [0, 10] } });
    expect(out.get("spindle")!.map((r) => r.record.t)).toEqual([1]);
  });

  it("ANDs multiple property filters on the same stream", () => {
    const m = streamMap({
      spindle: [
        { t: 1, value: 4, frequency: 13 },
        { t: 2, value: 4, frequency: 20 },
        { t: 3, value: 1, frequency: 13 },
      ],
    });
    const out = applyEventFilters(m, { spindle: { peak_z: [3, 5], frequency: [11, 16] } });
    expect(out.get("spindle")!.map((r) => r.record.t)).toEqual([1]);
  });

  it("passes through pinned streams that have no filter of their own", () => {
    const m = streamMap({
      spindle: [{ t: 1, value: 4 }],
      ripple: [{ t: 9, value: 2 }, { t: 10, value: 8 }],
    });
    const out = applyEventFilters(m, { spindle: { peak_z: [3, 5] } });
    // ripple untouched (same records), spindle filtered
    expect(out.get("ripple")).toBe(m.get("ripple"));
    expect(out.get("spindle")!.length).toBe(1);
  });
});
