// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDebouncedValue } from "./useDebouncedValue";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useDebouncedValue (Phase D)", () => {
  it("returns the initial value immediately", () => {
    const { result } = renderHook(() => useDebouncedValue([0, 1], 100));
    expect(result.current).toEqual([0, 1]);
  });

  it("publishes a new value only after the delay elapses", () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 100), {
      initialProps: { v: [0, 1] as [number, number] },
    });
    rerender({ v: [2, 3] });
    expect(result.current).toEqual([0, 1]); // not yet
    act(() => vi.advanceTimersByTime(99));
    expect(result.current).toEqual([0, 1]);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toEqual([2, 3]);
  });

  it("coalesces a burst — only the final value is published once it goes quiet", () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 100), {
      initialProps: { v: 0 },
    });
    rerender({ v: 1 });
    act(() => vi.advanceTimersByTime(50));
    rerender({ v: 2 }); // resets the timer
    act(() => vi.advanceTimersByTime(50)); // 100ms after the FIRST change, but timer was reset
    expect(result.current).toBe(0);
    rerender({ v: 3 }); // resets again
    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe(3); // skipped 1 and 2 entirely
  });

  it("passes through immediately when delay <= 0", () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 0), {
      initialProps: { v: 0 },
    });
    rerender({ v: 9 });
    expect(result.current).toBe(9);
  });
});
