// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { isWithinLoadedBuffer, overscanBuffer, useTimeNavigation } from "./useTimeNavigation";
import { useSelectionStore } from "../../store/selectionStore";
import type { CoordSummary } from "../../api/types";

const timeCoord: CoordSummary = {
  name: "time",
  dtype: "float64",
  length: 100_000,
  min: 0,
  max: 1000,
};

beforeEach(() => {
  vi.useFakeTimers();
  useSelectionStore.setState({
    timeCursor: 0,
    timeWindow: [0, 1],
    hasInitialized: false,
    spatial: { ap: 0, ml: 0, channel: null, hoveredId: null, selectedIds: [] },
    freq: { freq: 0 },
    event: { eventId: null, streamName: null },
  });
});
afterEach(() => vi.useRealTimers());

describe("useTimeNavigation — P5 Tier-2 fetch deprioritization", () => {
  it("exposes a distinct expensive window that trails the cheap window", () => {
    const { result } = renderHook(() => useTimeNavigation(timeCoord));
    expect(result.current.safeWindow).toEqual([0, 1]);
    expect(result.current.expensiveSafeWindow).toEqual([0, 1]);

    act(() => useSelectionStore.setState({ timeWindow: [10, 11] }));

    // Cheap window (~100 ms) updates first; the expensive window still trails.
    act(() => vi.advanceTimersByTime(100));
    expect(result.current.safeWindow).toEqual([10, 11]);
    expect(result.current.expensiveSafeWindow).toEqual([0, 1]);

    // Expensive window (~350 ms) catches up once the gesture has been quiet.
    act(() => vi.advanceTimersByTime(250));
    expect(result.current.expensiveSafeWindow).toEqual([10, 11]);
  });

  it("coalesces a rapid burst — the expensive window equals only the FINAL position", () => {
    const { result } = renderHook(() => useTimeNavigation(timeCoord));

    // Three window changes, each 150 ms apart (< the 350 ms expensive debounce,
    // so the expensive timer keeps resetting and never publishes an
    // intermediate window).
    act(() => useSelectionStore.setState({ timeWindow: [10, 11] }));
    act(() => vi.advanceTimersByTime(150));
    act(() => useSelectionStore.setState({ timeWindow: [20, 21] }));
    act(() => vi.advanceTimersByTime(150));
    act(() => useSelectionStore.setState({ timeWindow: [30, 31] }));

    // The cheap window has been tracking the burst, but the expensive window
    // has NOT yet published any intermediate window.
    act(() => vi.advanceTimersByTime(349));
    expect(result.current.expensiveSafeWindow).toEqual([0, 1]);

    // 350 ms after the final change → exactly the final window, skipping the
    // intermediate [10,11] / [20,21] entirely.
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.expensiveSafeWindow).toEqual([30, 31]);
  });
});

describe("overscanBuffer / isWithinLoadedBuffer — P7 pure helpers", () => {
  it("overscanBuffer widens by the overscan margin and tile-snaps the result", () => {
    // visible [8,12] (d=4) → ±2 margin → [6,14] → tile=2s snap → [6,16].
    expect(overscanBuffer([8, 12])).toEqual([6, 16]);
  });

  it("the buffer strictly contains the visible window", () => {
    const buf = overscanBuffer([8, 12]);
    expect(buf[0]).toBeLessThan(8);
    expect(buf[1]).toBeGreaterThan(12);
  });

  it("returns the input unchanged for a non-positive duration", () => {
    expect(overscanBuffer([5, 5])).toEqual([5, 5]);
  });

  it("isWithinLoadedBuffer is true only when fully contained (edges inclusive)", () => {
    expect(isWithinLoadedBuffer([9, 13], [6, 16])).toBe(true);
    expect(isWithinLoadedBuffer([6, 16], [6, 16])).toBe(true);
    expect(isWithinLoadedBuffer([5, 13], [6, 16])).toBe(false); // past the left edge
    expect(isWithinLoadedBuffer([9, 17], [6, 16])).toBe(false); // past the right edge
  });
});

describe("useTimeNavigation — P7 overscan buffer + local pan", () => {
  it("fetches a tile-snapped buffer WIDER than the visible window", () => {
    useSelectionStore.setState({ timeWindow: [8, 12] });
    const { result } = renderHook(() => useTimeNavigation(timeCoord));

    // The buffer overscans the [8,12] visible window to the snapped [6,16],
    // while `safeWindow` still trails the exact visible window (other views).
    expect(result.current.timeseriesFetchWindow).toEqual([6, 16]);
    expect(result.current.safeWindow).toEqual([8, 12]);
  });

  it("keeps the SAME buffer (stable fetch key) while a pan stays inside it", () => {
    useSelectionStore.setState({ timeWindow: [8, 12] });
    const { result } = renderHook(() => useTimeNavigation(timeCoord));
    const initial = result.current.timeseriesFetchWindow;
    expect(initial).toEqual([6, 16]);

    // Pan to [9,13] — still fully inside [6,16]. The visible window (and
    // therefore `safeWindow`) moves, but the buffer is held byte-identical
    // (same reference) so the timeseries request key doesn't churn → no
    // refetch; the renderer pans over already-loaded data.
    act(() => useSelectionStore.setState({ timeWindow: [9, 13] }));
    act(() => vi.advanceTimersByTime(100));
    expect(result.current.safeWindow).toEqual([9, 13]);
    expect(result.current.timeseriesFetchWindow).toBe(initial);
  });

  it("recomputes a fresh tile-snapped buffer when the pan leaves the buffer", () => {
    useSelectionStore.setState({ timeWindow: [8, 12] });
    const { result } = renderHook(() => useTimeNavigation(timeCoord));
    expect(result.current.timeseriesFetchWindow).toEqual([6, 16]);

    // Pan to [15,19] — past the right edge of [6,16] → a new buffer is fetched.
    act(() => useSelectionStore.setState({ timeWindow: [15, 19] }));
    act(() => vi.advanceTimersByTime(100));
    expect(result.current.timeseriesFetchWindow).toEqual([12, 22]);
  });
});
