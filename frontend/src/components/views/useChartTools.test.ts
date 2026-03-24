// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChartTools } from "./useChartTools";
import type uPlot from "uplot";

// Minimal uPlot stub — only the surface useChartTools and attachGestures touch
function makeChartStub(initMin = 0, initMax = 10): uPlot {
  const scales: Record<string, { min: number | null; max: number | null }> = {
    x: { min: initMin, max: initMax },
  };
  return {
    scales,
    setScale: vi.fn((key: string, { min, max }: { min: number; max: number }) => {
      scales[key] = { min, max };
    }),
    over: document.createElement("div"),
  } as unknown as uPlot;
}

describe("useChartTools", () => {
  it("initialises with zoom tool, wheel zoom on, and auto y-mode", () => {
    const chartRef = { current: null as uPlot | null };
    const { result } = renderHook(() => useChartTools(chartRef));
    expect(result.current.activeTool).toBe("zoom");
    expect(result.current.wheelZoom).toBe(true);
    expect(result.current.yMode).toBe("auto");
  });

  it("cycles through y-modes: auto → fixed → fit", () => {
    const chartRef = { current: null as uPlot | null };
    const { result } = renderHook(() => useChartTools(chartRef));
    expect(result.current.yMode).toBe("auto");
    act(() => result.current.setYMode("fixed"));
    expect(result.current.yMode).toBe("fixed");
    expect(result.current.yModeRef.current).toBe("fixed");
    act(() => result.current.setYMode("fit"));
    expect(result.current.yMode).toBe("fit");
    expect(result.current.yModeRef.current).toBe("fit");
    act(() => result.current.setYMode("auto"));
    expect(result.current.yMode).toBe("auto");
  });

  it("switches tool via setActiveTool", () => {
    const chartRef = { current: null as uPlot | null };
    const { result } = renderHook(() => useChartTools(chartRef));
    act(() => result.current.setActiveTool("pan"));
    expect(result.current.activeTool).toBe("pan");
  });

  it("toggles wheel zoom", () => {
    const chartRef = { current: null as uPlot | null };
    const { result } = renderHook(() => useChartTools(chartRef));
    act(() => result.current.toggleWheelZoom());
    expect(result.current.wheelZoom).toBe(false);
    act(() => result.current.toggleWheelZoom());
    expect(result.current.wheelZoom).toBe(true);
  });

  it("toolRef mirrors activeTool after state update", async () => {
    const chartRef = { current: null as uPlot | null };
    const { result } = renderHook(() => useChartTools(chartRef));
    act(() => result.current.setActiveTool("pan"));
    // The ref update happens in a useEffect — flush it
    expect(result.current.toolRef.current).toBe("pan");
  });

  describe("reset", () => {
    it("does nothing when no chart has been registered", () => {
      const chartRef = { current: null as uPlot | null };
      const { result } = renderHook(() => useChartTools(chartRef));
      expect(() => result.current.reset()).not.toThrow();
    });

    it("calls setScale with initial x bounds after onChartCreated", () => {
      const chart = makeChartStub(2, 8);
      const chartRef = { current: chart };
      const { result } = renderHook(() => useChartTools(chartRef));

      act(() => result.current.onChartCreated(chart));

      // Simulate user zoom
      chart.scales.x = { min: 4, max: 6 };

      act(() => result.current.reset());

      expect(chart.setScale).toHaveBeenCalledWith("x", { min: 2, max: 8 });
    });

    it("does nothing when chartRef.current is null at reset time", () => {
      const chart = makeChartStub(0, 5);
      const chartRef: { current: uPlot | null } = { current: chart };
      const { result } = renderHook(() => useChartTools(chartRef));

      act(() => result.current.onChartCreated(chart));
      // Simulate chart destruction
      chartRef.current = null;

      expect(() => result.current.reset()).not.toThrow();
      expect(chart.setScale).not.toHaveBeenCalled();
    });

    it("uses the latest onChartCreated bounds when chart is recreated", () => {
      const chart1 = makeChartStub(0, 10);
      const chart2 = makeChartStub(5, 20);
      const chartRef = { current: chart1 };
      const { result } = renderHook(() => useChartTools(chartRef));

      act(() => result.current.onChartCreated(chart1));
      // Chart recreated with new data
      chartRef.current = chart2;
      act(() => result.current.onChartCreated(chart2));

      act(() => result.current.reset());

      expect(chart2.setScale).toHaveBeenCalledWith("x", { min: 5, max: 20 });
      expect(chart1.setScale).not.toHaveBeenCalled();
    });
  });
});
