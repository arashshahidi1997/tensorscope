import { describe, it, expect } from "vitest";
import {
  applyEventFilters,
  canonicalProperty,
  computeHistogram,
  enumerateFilterableProperties,
  propertyValues,
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

describe("canonicalProperty", () => {
  it("collapses detector aliases to a canonical key, case-insensitively", () => {
    expect(canonicalProperty("value")).toBe("peak_z");
    expect(canonicalProperty("freq")).toBe("frequency");
    expect(canonicalProperty("FREQ_PEAK")).toBe("frequency");
    expect(canonicalProperty("amplitude")).toBe("amplitude"); // unknown → itself
  });
});

describe("enumerateFilterableProperties", () => {
  it("offers only ranged numeric properties; excludes structural/constant cols", () => {
    // Mirrors the demo `events` stream columns.
    const records = [
      rec({ event_id: 0, t: 0.66, AP: 0.5, ML: 0.0, freq: 11.3, amplitude: 1.5, label: "burst" }),
      rec({ event_id: 1, t: 1.68, AP: 0.4, ML: 0.7, freq: 9.0, amplitude: 1.5, label: "burst" }),
      rec({ event_id: 2, t: 3.11, AP: 0.2, ML: 0.5, freq: 10.3, amplitude: 1.5, label: "burst" }),
    ];
    const cols = ["event_id", "t", "AP", "ML", "freq", "amplitude", "label"];
    const props = enumerateFilterableProperties(records, cols, ["t", "event_id"]);
    const keys = props.map((p) => p.key);
    // freq → canonical `frequency` (ranged); amplitude constant (min==max) dropped;
    // event_id/t/AP/ML/label all excluded; no span → no `duration`.
    expect(keys).toEqual(["frequency"]);
    const freq = props.find((p) => p.key === "frequency")!;
    expect(freq.min).toBeCloseTo(9.0);
    expect(freq.max).toBeCloseTo(11.3);
    expect(freq.label).toBe("frequency (Hz)");
  });

  it("offers a computed `duration` for interval events", () => {
    const records = [
      rec({ t: 1, t0: 0.9, t1: 1.2, value: 3 }),
      rec({ t: 2, t0: 1.8, t1: 2.5, value: 5 }),
    ];
    const props = enumerateFilterableProperties(records, ["t", "t0", "t1", "value"], ["t"]);
    const keys = props.map((p) => p.key).sort();
    expect(keys).toContain("duration");
    expect(keys).toContain("peak_z"); // value → peak_z
    const dur = props.find((p) => p.key === "duration")!;
    expect(dur.min).toBeCloseTo(0.3);
    expect(dur.max).toBeCloseTo(0.7);
  });
});

describe("computeHistogram", () => {
  it("bins values into equal-width buckets, max in the last bin", () => {
    const h = computeHistogram([0, 1, 2, 3, 4], 4);
    expect(h.min).toBe(0);
    expect(h.max).toBe(4);
    expect(h.binWidth).toBe(1);
    // edges [0,1),[1,2),[2,3),[3,4]; 4 lands in the last bin
    expect(h.counts).toEqual([1, 1, 1, 2]);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(5);
  });

  it("returns a single full bin when all values are equal", () => {
    expect(computeHistogram([1.5, 1.5, 1.5], 10)).toEqual({
      counts: [3],
      min: 1.5,
      max: 1.5,
      binWidth: 0,
    });
  });

  it("ignores non-finite values and handles empty input", () => {
    expect(computeHistogram([NaN, Infinity], 5).counts).toEqual([]);
    expect(computeHistogram([], 5).counts).toEqual([]);
  });
});

describe("propertyValues", () => {
  it("resolves every finite value of a canonical property (alias-aware)", () => {
    const records = [rec({ value: 3 }), rec({ value: "5" }), rec({ /* missing */ })];
    expect(propertyValues(records, "peak_z")).toEqual([3, 5]);
  });
});
