// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRef } from "react";
import { useHeatmapGestures } from "./useHeatmapGestures";

/**
 * Drives the hook and exposes the canvas ref it needs. We don't actually paint
 * anything — the gesture-attach effect tolerates a detached canvas.
 */
function useGesturesWithCanvas(opts: Omit<Parameters<typeof useHeatmapGestures>[0], "canvasRef"> & {
  externalXRange?: [number, number];
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(document.createElement("canvas"));
  return useHeatmapGestures({ canvasRef, ...opts });
}

describe("useHeatmapGestures", () => {
  it("initialises viewport to data bounds when no externalXRange is given", () => {
    const { result } = renderHook(() =>
      useGesturesWithCanvas({ xRange: [0, 10], yRange: [1, 100] }),
    );
    expect(result.current.viewport).toEqual({ xLo: 0, xHi: 10, yLo: 1, yHi: 100 });
  });

  it("pins viewport.x to externalXRange on first render", () => {
    const { result } = renderHook(() =>
      useGesturesWithCanvas({
        xRange: [0, 10],
        yRange: [1, 100],
        externalXRange: [5, 7],
      }),
    );
    expect(result.current.viewport.xLo).toBe(5);
    expect(result.current.viewport.xHi).toBe(7);
    // Y still derived from data bounds
    expect(result.current.viewport.yLo).toBe(1);
    expect(result.current.viewport.yHi).toBe(100);
  });

  it("re-syncs viewport.x when externalXRange changes (the SSE-pan path)", () => {
    // Start at [0, 10] — the agent then publishes set_selection(time=120),
    // which re-centres timeWindow to [119.5, 120.5] in the store. The view
    // re-renders with the new externalXRange and the chart's viewport must
    // follow.
    const { result, rerender } = renderHook(
      ({ ext }: { ext: [number, number] }) =>
        useGesturesWithCanvas({
          xRange: [0, 10],
          yRange: [1, 100],
          externalXRange: ext,
        }),
      { initialProps: { ext: [0, 10] as [number, number] } },
    );
    expect(result.current.viewport.xLo).toBe(0);
    expect(result.current.viewport.xHi).toBe(10);

    rerender({ ext: [119.5, 120.5] });
    expect(result.current.viewport.xLo).toBe(119.5);
    expect(result.current.viewport.xHi).toBe(120.5);
  });

  it("falls back to data bounds when externalXRange has non-finite values", () => {
    const { result } = renderHook(() =>
      useGesturesWithCanvas({
        xRange: [0, 10],
        yRange: [1, 100],
        externalXRange: [Number.NaN, Number.NaN] as unknown as [number, number],
      }),
    );
    expect(result.current.viewport.xLo).toBe(0);
    expect(result.current.viewport.xHi).toBe(10);
  });

  it("data-bounds change is overridden by externalXRange when both shift", () => {
    // Simulates the bug case: a fresh slice arrives at [119.5, 120.5] (so the
    // hook sees new data bounds), but the store-driven externalXRange is the
    // SAME [119.5, 120.5]. The viewport should land on the external range,
    // not the implicit data-bounds reset.
    const { result, rerender } = renderHook(
      ({ x, ext }: { x: [number, number]; ext: [number, number] }) =>
        useGesturesWithCanvas({
          xRange: x,
          yRange: [1, 100],
          externalXRange: ext,
        }),
      {
        initialProps: {
          x: [0, 10] as [number, number],
          ext: [0, 10] as [number, number],
        },
      },
    );
    rerender({
      x: [119.5, 120.5] as [number, number],
      ext: [119.5, 120.5] as [number, number],
    });
    expect(result.current.viewport.xLo).toBe(119.5);
    expect(result.current.viewport.xHi).toBe(120.5);
  });

  it("user pan / zoom still works when externalXRange is set (cursor sets viewport state)", () => {
    // Confirms the hook isn't 'frozen' on externalXRange — the data-bounds
    // reset effect only fires when the inputs change. User-driven setViewport
    // (via gesture handlers) operates on the existing viewport and is not
    // affected here. We assert the behaviour indirectly via resetViewport.
    const { result } = renderHook(() =>
      useGesturesWithCanvas({
        xRange: [0, 10],
        yRange: [1, 100],
        externalXRange: [3, 5],
      }),
    );
    expect(result.current.viewport.xLo).toBe(3);
    act(() => result.current.resetViewport());
    // resetViewport snaps to the *data* bounds (not external) — that's the
    // documented escape hatch for users who got disoriented.
    expect(result.current.viewport.xLo).toBe(0);
    expect(result.current.viewport.xHi).toBe(10);
  });
});
