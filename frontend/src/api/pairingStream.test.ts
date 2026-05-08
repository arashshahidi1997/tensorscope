import { describe, it, expect, beforeEach, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { handlePairingMessage } from "./pairingStream";
import { useSelectionStore } from "../store/selectionStore";

beforeEach(() => {
  useSelectionStore.setState({
    timeCursor: 0,
    timeWindow: [0, 2],
    viewportDuration: 1,
    spatial: { ap: 0, ml: 0, channel: null, hoveredId: null, selectedIds: [] },
    freq: { freq: 0 },
    event: { eventId: null, streamName: null },
  });
});

function freshClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("handlePairingMessage", () => {
  it("invalidates state on tensor_added", () => {
    const qc = freshClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    handlePairingMessage(
      JSON.stringify({ type: "tensor_added", payload: { name: "synth" } }),
      qc,
    );
    expect(spy).toHaveBeenCalledWith({ queryKey: ["state"] });
  });

  it("invalidates state on events_added", () => {
    const qc = freshClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    handlePairingMessage(
      JSON.stringify({ type: "events_added", payload: { name: "ripples" } }),
      qc,
    );
    expect(spy).toHaveBeenCalledWith({ queryKey: ["state"] });
  });

  it("syncs selection store and invalidates slice on selection_changed", () => {
    const qc = freshClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    handlePairingMessage(
      JSON.stringify({
        type: "selection_changed",
        payload: { time: 5.0, freq: 12.0, ap: 1, ml: 2, channel: null },
      }),
      qc,
    );
    expect(useSelectionStore.getState().timeCursor).toBe(5.0);
    expect(useSelectionStore.getState().freq.freq).toBe(12.0);
    expect(useSelectionStore.getState().spatial.ap).toBe(1);
    expect(useSelectionStore.getState().spatial.ml).toBe(2);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["slice"] });
  });

  it("re-centers timeWindow when selection_changed pushes a far-away cursor", () => {
    // Regression for issue-arash-20260508-142724-956601: agent set_selection
    // (time=120.0) must re-center the visible window so viewport-bound views
    // (timeseries, spectrogram) follow. The store-side re-centering is
    // tested here; the chart-side wiring (timeWindow prop → chart x-scale)
    // is covered by useHeatmapGestures.test.ts and the component prop type.
    //
    // GAP: The full TimeseriesSliceView / SpectrogramView render path uses
    // uPlot + canvas which don't run in jsdom; the
    // store→prop→chart.setScale wiring in TimeseriesSliceView is verified
    // by manual smoke against the live --pair server. Pixecog orchestrator
    // exercises this on every release of the pairing API.
    useSelectionStore.setState({ timeCursor: 0, timeWindow: [0, 10], viewportDuration: 1 });
    const qc = freshClient();
    handlePairingMessage(
      JSON.stringify({
        type: "selection_changed",
        payload: { time: 120.0, freq: 0, ap: 0, ml: 0, channel: null },
      }),
      qc,
    );
    const s = useSelectionStore.getState();
    expect(s.timeCursor).toBe(120);
    // timeWindow re-centered around 120 with viewportDuration=1 → [119.5, 120.5]
    expect(s.timeWindow[0]).toBeCloseTo(119.5);
    expect(s.timeWindow[1]).toBeCloseTo(120.5);
  });

  it("ignores malformed JSON", () => {
    const qc = freshClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    handlePairingMessage("not-json", qc);
    expect(spy).not.toHaveBeenCalled();
  });

  it("ignores unknown event types", () => {
    const qc = freshClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    handlePairingMessage(
      JSON.stringify({ type: "noop", payload: {} }),
      qc,
    );
    expect(spy).not.toHaveBeenCalled();
  });
});
