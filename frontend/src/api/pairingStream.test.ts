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
