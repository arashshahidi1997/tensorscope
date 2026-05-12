import { describe, expect, it } from "vitest";
import {
  coincidenceIndicesByStream,
  countActiveStreamCoincidences,
  extractEventTimes,
  pairwiseMatches,
  type StreamEvent,
} from "./coincidence";
import type { EventRecordDTO, EventStreamMetaDTO } from "./types";

function ev(t: number, idx: number): StreamEvent {
  return { t, idx };
}

const meta = (name: string): EventStreamMetaDTO => ({
  name,
  time_col: "t",
  id_col: "id",
  n_events: 0,
  time_range: [0, 100],
  columns: ["t", "id"],
});

function records(times: number[]): EventRecordDTO[] {
  return times.map((t, i) => ({ record: { t, id: i } }));
}

describe("pairwiseMatches", () => {
  it("returns nothing for empty arrays", () => {
    expect(pairwiseMatches([], [ev(0, 0)], 0.1)).toEqual([]);
    expect(pairwiseMatches([ev(0, 0)], [], 0.1)).toEqual([]);
  });

  it("matches a single pair within the window", () => {
    const a = [ev(1.0, 0)];
    const b = [ev(1.05, 0)];
    const out = pairwiseMatches(a, b, 0.1);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ a: a[0], b: b[0] });
  });

  it("rejects a pair outside the window", () => {
    const a = [ev(1.0, 0)];
    const b = [ev(1.2, 0)];
    expect(pairwiseMatches(a, b, 0.1)).toEqual([]);
  });

  it("includes events exactly at the window boundary", () => {
    const a = [ev(1.0, 0)];
    const b = [ev(1.1, 0)];
    expect(pairwiseMatches(a, b, 0.1)).toHaveLength(1);
  });

  it("emits multiple matches when a single A is near several B", () => {
    const a = [ev(1.0, 0)];
    const b = [ev(0.95, 0), ev(1.02, 1), ev(1.09, 2), ev(1.2, 3)];
    const out = pairwiseMatches(a, b, 0.1);
    expect(out.map((p) => p.b.idx)).toEqual([0, 1, 2]);
  });

  it("walks sparse and dense streams efficiently (no false negatives)", () => {
    const a = [ev(0.1, 0), ev(5.0, 1), ev(9.9, 2)];
    const b = [ev(0.15, 0), ev(2.5, 1), ev(5.05, 2), ev(9.85, 3)];
    const out = pairwiseMatches(a, b, 0.1);
    expect(out.map((p) => [p.a.idx, p.b.idx])).toEqual([
      [0, 0],
      [1, 2],
      [2, 3],
    ]);
  });

  it("treats negative window as no match", () => {
    expect(pairwiseMatches([ev(1, 0)], [ev(1, 0)], -1)).toEqual([]);
  });
});

describe("extractEventTimes", () => {
  it("reads from the meta's time_col with `t` fallback", () => {
    const recs: EventRecordDTO[] = [
      { record: { t: 1.5, id: 0 } },
      { record: { time: 2.0, id: 1 } },
      { record: { t: "junk", id: 2 } },
    ];
    const got = extractEventTimes(recs, { ...meta("spindle"), time_col: "time" });
    // Index 0: no `time` col → falls back to `t` (1.5)
    // Index 1: `time` col present → 2.0
    // Index 2: t="junk" → NaN → dropped
    expect(got).toEqual([
      { t: 1.5, idx: 0 },
      { t: 2.0, idx: 1 },
    ]);
  });

  it("handles a null meta by reading `record.t`", () => {
    const got = extractEventTimes(records([1, 2, 3]), null);
    expect(got).toHaveLength(3);
    expect(got[0]).toEqual({ t: 1, idx: 0 });
  });
});

describe("coincidenceIndicesByStream", () => {
  it("marks both sides of every cross-stream match within window", () => {
    const byStream = new Map<string, StreamEvent[]>([
      ["spindle", [ev(1.0, 0), ev(2.0, 1), ev(3.0, 2)]],
      ["ripple", [ev(1.05, 0), ev(2.5, 1), ev(3.0, 2)]],
    ]);
    const got = coincidenceIndicesByStream(byStream, 0.1);
    // spindle@1.0 ↔ ripple@1.05; spindle@3.0 ↔ ripple@3.0
    // spindle@2.0 has no match (ripple's nearest is 2.5, outside window)
    expect(Array.from(got.get("spindle")!).sort()).toEqual([0, 2]);
    expect(Array.from(got.get("ripple")!).sort()).toEqual([0, 2]);
  });

  it("returns empty sets when no pair is within window", () => {
    const byStream = new Map<string, StreamEvent[]>([
      ["spindle", [ev(0, 0), ev(1, 1)]],
      ["ripple", [ev(10, 0), ev(11, 1)]],
    ]);
    const got = coincidenceIndicesByStream(byStream, 0.1);
    expect(got.get("spindle")!.size).toBe(0);
    expect(got.get("ripple")!.size).toBe(0);
  });

  it("preserves original input indices even when stream is unsorted", () => {
    // Caller's array is OUT of time order — the coincidence pass must
    // still mark the original positions, not the post-sort positions.
    const byStream = new Map<string, StreamEvent[]>([
      ["A", [ev(5, 0), ev(1, 1), ev(3, 2)]],
      ["B", [ev(3.05, 0)]],
    ]);
    const got = coincidenceIndicesByStream(byStream, 0.1);
    expect(Array.from(got.get("A")!)).toEqual([2]); // idx 2 → t=3
    expect(Array.from(got.get("B")!)).toEqual([0]);
  });

  it("symmetric across N>2 streams (pairwise across all pairs)", () => {
    const byStream = new Map<string, StreamEvent[]>([
      ["A", [ev(1.0, 0)]],
      ["B", [ev(1.05, 0)]],
      ["C", [ev(5.0, 0)]],
    ]);
    const got = coincidenceIndicesByStream(byStream, 0.1);
    expect(got.get("A")!.size).toBe(1);
    expect(got.get("B")!.size).toBe(1);
    expect(got.get("C")!.size).toBe(0);
  });

  it("handles a stream with no events without crashing", () => {
    const byStream = new Map<string, StreamEvent[]>([
      ["A", []],
      ["B", [ev(1.0, 0)]],
    ]);
    const got = coincidenceIndicesByStream(byStream, 0.1);
    expect(got.get("A")!.size).toBe(0);
    expect(got.get("B")!.size).toBe(0);
  });
});

describe("countActiveStreamCoincidences", () => {
  it("counts only events in the active stream that have ANY cross-match", () => {
    const byStream = new Map<string, StreamEvent[]>([
      // spindle has 4 events; events 0 and 2 each have a ripple match
      // within 0.1s; event 3 has a slow-osc match (also active).
      ["spindle", [ev(1.0, 0), ev(2.0, 1), ev(3.0, 2), ev(4.0, 3)]],
      ["ripple", [ev(1.02, 0), ev(3.05, 1)]],
      ["slow", [ev(4.07, 0)]],
    ]);
    const n = countActiveStreamCoincidences(byStream, "spindle", 0.1);
    expect(n).toBe(3); // events 0, 2, 3
  });

  it("returns 0 when the active stream has no events", () => {
    const byStream = new Map<string, StreamEvent[]>([
      ["spindle", []],
      ["ripple", [ev(1, 0)]],
    ]);
    expect(countActiveStreamCoincidences(byStream, "spindle", 0.1)).toBe(0);
  });

  it("returns 0 when only one stream is in the map", () => {
    const byStream = new Map<string, StreamEvent[]>([
      ["spindle", [ev(1, 0), ev(2, 1)]],
    ]);
    expect(countActiveStreamCoincidences(byStream, "spindle", 0.1)).toBe(0);
  });

  it("does not double-count an event matched by two other streams", () => {
    const byStream = new Map<string, StreamEvent[]>([
      ["spindle", [ev(1.0, 0)]],
      ["ripple", [ev(1.05, 0)]],
      ["slow", [ev(0.97, 0)]],
    ]);
    // spindle's single event matches both ripple and slow.
    expect(countActiveStreamCoincidences(byStream, "spindle", 0.1)).toBe(1);
  });
});
