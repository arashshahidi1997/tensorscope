import { describe, it, expect, beforeEach } from "vitest";
import { useSelectionStore, toSelectionDTO } from "./selectionStore";
import type { SelectionDTO } from "../api/types";

// Reset store to defaults between tests
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

const getStore = () => useSelectionStore.getState();

describe("setTimeCursor", () => {
  it("updates timeCursor", () => {
    getStore().setTimeCursor(1.5);
    expect(getStore().timeCursor).toBe(1.5);
  });

  it("preserves window when cursor stays inside", () => {
    useSelectionStore.setState({ timeWindow: [0, 5] });
    getStore().setTimeCursor(2.5);
    expect(getStore().timeWindow).toEqual([0, 5]);
  });

  it("re-centers window when cursor jumps outside", () => {
    useSelectionStore.setState({ timeWindow: [0, 2], viewportDuration: 2 });
    getStore().setTimeCursor(10);
    expect(getStore().timeWindow[0]).toBeCloseTo(9);
    expect(getStore().timeWindow[1]).toBeCloseTo(11);
  });

  it("clamps window start to 0 for very early times", () => {
    // Start with a window that won't contain 0.3; viewportDuration=2 → window [-0.7, 1.3] → clamped [0, 1.3]
    useSelectionStore.setState({ timeWindow: [5, 10], viewportDuration: 2 });
    getStore().setTimeCursor(0.3);
    expect(getStore().timeWindow[0]).toBe(0);
    expect(getStore().timeWindow[1]).toBeCloseTo(1.3);
  });
});

describe("setTimeWindow", () => {
  it("updates timeWindow independently of cursor", () => {
    getStore().setTimeWindow([3, 7]);
    expect(getStore().timeWindow).toEqual([3, 7]);
    expect(getStore().timeCursor).toBe(0); // unchanged
  });
});

describe("patchSpatial", () => {
  it("merges partial spatial update", () => {
    useSelectionStore.setState({ spatial: { ap: 2, ml: 3, channel: null, hoveredId: null, selectedIds: [] } });
    getStore().patchSpatial({ ap: 5 });
    expect(getStore().spatial).toEqual({ ap: 5, ml: 3, channel: null, hoveredId: null, selectedIds: [] });
  });
});

describe("initFromDTO", () => {
  it("bootstraps all navigation fields from DTO", () => {
    const dto: SelectionDTO = { time: 4, freq: 60, ap: 2, ml: 3, channel: null };
    getStore().initFromDTO(dto);
    expect(getStore().timeCursor).toBe(4);
    expect(getStore().freq.freq).toBe(60);
    expect(getStore().spatial).toEqual({ ap: 2, ml: 3, channel: null, hoveredId: null, selectedIds: [] });
  });

  it("re-centers window when time changes", () => {
    getStore().initFromDTO({ time: 10, freq: 0, ap: 0, ml: 0, channel: null });
    expect(getStore().timeWindow[0]).toBe(9.5);
    expect(getStore().timeWindow[1]).toBe(10.5);
  });

  it("preserves window when time is unchanged", () => {
    useSelectionStore.setState({ timeCursor: 5, timeWindow: [3, 9] });
    getStore().initFromDTO({ time: 5, freq: 30, ap: 1, ml: 1, channel: null });
    expect(getStore().timeWindow).toEqual([3, 9]);
  });

  it("uses explicit timeWindow argument when provided", () => {
    getStore().initFromDTO({ time: 5, freq: 0, ap: 0, ml: 0, channel: null }, [0, 20]);
    expect(getStore().timeWindow).toEqual([0, 20]);
  });

  it("preserves existing event selection", () => {
    useSelectionStore.setState({ event: { eventId: 42, streamName: "trials" } });
    getStore().initFromDTO({ time: 1, freq: 0, ap: 0, ml: 0, channel: null });
    expect(getStore().event).toEqual({ eventId: 42, streamName: "trials" });
  });
});

describe("patchFromDTO", () => {
  it("updates only time when only time is patched", () => {
    useSelectionStore.setState({ spatial: { ap: 2, ml: 3, channel: null, hoveredId: null, selectedIds: [] }, freq: { freq: 50 } });
    getStore().patchFromDTO({ time: 3 });
    expect(getStore().timeCursor).toBe(3);
    expect(getStore().spatial.ap).toBe(2); // unchanged
    expect(getStore().freq.freq).toBe(50); // unchanged
  });

  it("updates spatial when ap or ml is patched", () => {
    useSelectionStore.setState({ spatial: { ap: 2, ml: 3, channel: null, hoveredId: null, selectedIds: [] } });
    getStore().patchFromDTO({ ap: 5 });
    expect(getStore().spatial).toEqual({ ap: 5, ml: 3, channel: null, hoveredId: null, selectedIds: [] });
  });

  it("updates freq when freq is patched", () => {
    getStore().patchFromDTO({ freq: 120 });
    expect(getStore().freq.freq).toBe(120);
  });
});

describe("toSelectionDTO", () => {
  it("round-trips state to DTO", () => {
    const dto: SelectionDTO = { time: 2, freq: 40, ap: 1, ml: 2, channel: 5 };
    getStore().initFromDTO(dto);
    expect(toSelectionDTO(getStore())).toEqual(dto);
  });
});

describe("linked update semantics", () => {
  it("timeseries + navigator share timeWindow — setTimeWindow is observable by all", () => {
    // Simulate navigator publishing a new window
    getStore().setTimeWindow([5, 10]);
    // Any view reading from the same store sees the update
    expect(getStore().timeWindow).toEqual([5, 10]);
  });

  it("spatial map click propagates to shared state", () => {
    // Simulate spatial map publishing an ap/ml selection
    getStore().patchSpatial({ ap: 3, ml: 7 });
    expect(getStore().spatial.ap).toBe(3);
    expect(getStore().spatial.ml).toBe(7);
  });

  it("event navigation updates timeCursor and re-centers window using viewportDuration", () => {
    useSelectionStore.setState({ timeWindow: [0, 2], viewportDuration: 1 });
    // Simulate event table committing a new time outside the visible window
    getStore().setTimeCursor(15);
    const s = getStore();
    expect(s.timeCursor).toBe(15);
    // Re-centers at viewportDuration=1: [14.5, 15.5]
    expect(s.timeWindow).toEqual([14.5, 15.5]);
  });
});

describe("overview↔detail contract", () => {
  it("navigator drag publishes window → detail slice key changes", () => {
    // Simulate navigator: user drags to zoom [3, 7]
    getStore().setTimeWindow([3, 7]);
    expect(getStore().timeWindow).toEqual([3, 7]);
    // Any view subscribed to timeWindow would re-fetch with the new range
  });

  it("detail pan publishes window → navigator highlights same range", () => {
    // Simulate timeseries: user pans to [5, 10]
    getStore().setTimeWindow([5, 10]);
    expect(getStore().timeWindow).toEqual([5, 10]);
    // Navigator reads the same timeWindow from the store
  });

  it("window update does not move timeCursor", () => {
    useSelectionStore.setState({ timeCursor: 4, timeWindow: [0, 10] });
    getStore().setTimeWindow([2, 8]);
    expect(getStore().timeCursor).toBe(4); // cursor unchanged
    expect(getStore().timeWindow).toEqual([2, 8]);
  });

  it("cursor commit (initFromDTO) re-centers window only when time changes", () => {
    useSelectionStore.setState({ timeCursor: 5, timeWindow: [3, 9] });
    // Server responds with the same time → window should be preserved
    getStore().initFromDTO({ time: 5, freq: 0, ap: 0, ml: 0, channel: null });
    expect(getStore().timeWindow).toEqual([3, 9]);
  });

  it("cursor commit with new time re-centers window", () => {
    useSelectionStore.setState({ timeCursor: 5, timeWindow: [3, 9] });
    getStore().initFromDTO({ time: 20, freq: 0, ap: 0, ml: 0, channel: null });
    expect(getStore().timeCursor).toBe(20);
    expect(getStore().timeWindow).toEqual([19.5, 20.5]);
  });

  it("multiple views publishing window converge on last write", () => {
    // Navigator publishes [0, 10]
    getStore().setTimeWindow([0, 10]);
    // Timeseries user zooms to [2, 6]
    getStore().setTimeWindow([2, 6]);
    // Navigator user drag zooms to [3, 5]
    getStore().setTimeWindow([3, 5]);
    expect(getStore().timeWindow).toEqual([3, 5]);
  });
});

describe("event-centric navigation", () => {
  it("setEvent updates eventId and streamName", () => {
    getStore().setEvent({ eventId: 42, streamName: "trials" });
    expect(getStore().event.eventId).toBe(42);
    expect(getStore().event.streamName).toBe("trials");
  });

  it("setEvent with string id", () => {
    getStore().setEvent({ eventId: "trial-007", streamName: "events" });
    expect(getStore().event.eventId).toBe("trial-007");
  });

  it("setEvent does not affect timeCursor or timeWindow", () => {
    useSelectionStore.setState({ timeCursor: 5, timeWindow: [3, 9] });
    getStore().setEvent({ eventId: 1, streamName: "trials" });
    expect(getStore().timeCursor).toBe(5);
    expect(getStore().timeWindow).toEqual([3, 9]);
  });

  it("setEvent does not affect spatial selection", () => {
    useSelectionStore.setState({ spatial: { ap: 2, ml: 3, channel: null, hoveredId: null, selectedIds: [] } });
    getStore().setEvent({ eventId: 5, streamName: "trials" });
    expect(getStore().spatial).toEqual({ ap: 2, ml: 3, channel: null, hoveredId: null, selectedIds: [] });
  });

  it("clearing event (null ids) resets event selection", () => {
    getStore().setEvent({ eventId: 42, streamName: "trials" });
    getStore().setEvent({ eventId: null, streamName: null });
    expect(getStore().event.eventId).toBeNull();
    expect(getStore().event.streamName).toBeNull();
  });

  it("initFromDTO preserves event selection across server commits", () => {
    getStore().setEvent({ eventId: 99, streamName: "trials" });
    getStore().initFromDTO({ time: 3, freq: 0, ap: 0, ml: 0, channel: null });
    // Event identity survives the server round-trip sync
    expect(getStore().event.eventId).toBe(99);
    expect(getStore().event.streamName).toBe("trials");
  });

  it("event selection and timeCursor update independently", () => {
    // Set event identity first (store-local)
    getStore().setEvent({ eventId: 7, streamName: "trials" });
    // Then commit time cursor (server round-trip result)
    getStore().initFromDTO({ time: 8, freq: 0, ap: 0, ml: 0, channel: null });
    expect(getStore().event.eventId).toBe(7);   // preserved
    expect(getStore().timeCursor).toBe(8);       // updated
  });
});
