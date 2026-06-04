// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTimeNavigation } from "./useTimeNavigation";
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
