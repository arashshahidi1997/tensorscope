// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { useEventStreamsStore } from "./eventStreamsStore";

function resetStore(): void {
  useEventStreamsStore.setState({
    pinnedStreams: [],
    activeStreamName: null,
    coincidenceWindow: 0.1,
  });
}

describe("eventStreamsStore", () => {
  beforeEach(() => {
    resetStore();
    window.localStorage?.removeItem?.("tensorscope:event-streams");
  });

  it("pinStream appends and auto-activates when first pinned", () => {
    const s = useEventStreamsStore.getState();
    s.pinStream("spindle");
    const st = useEventStreamsStore.getState();
    expect(st.pinnedStreams).toEqual(["spindle"]);
    expect(st.activeStreamName).toBe("spindle");
  });

  it("pinStream is idempotent and preserves order", () => {
    const s = useEventStreamsStore.getState();
    s.pinStream("spindle");
    s.pinStream("ripple");
    s.pinStream("spindle");
    expect(useEventStreamsStore.getState().pinnedStreams).toEqual(["spindle", "ripple"]);
  });

  it("pinStream does NOT switch active when another is already active", () => {
    const s = useEventStreamsStore.getState();
    s.pinStream("spindle");
    s.pinStream("ripple");
    expect(useEventStreamsStore.getState().activeStreamName).toBe("spindle");
  });

  it("setActiveStream auto-pins if the stream isn't pinned yet", () => {
    useEventStreamsStore.getState().setActiveStream("ripple");
    const st = useEventStreamsStore.getState();
    expect(st.pinnedStreams).toEqual(["ripple"]);
    expect(st.activeStreamName).toBe("ripple");
  });

  it("unpinStream picks a fallback active stream", () => {
    const s = useEventStreamsStore.getState();
    s.pinStream("spindle");
    s.pinStream("ripple");
    useEventStreamsStore.getState().unpinStream("spindle");
    expect(useEventStreamsStore.getState().activeStreamName).toBe("ripple");
    useEventStreamsStore.getState().unpinStream("ripple");
    expect(useEventStreamsStore.getState().activeStreamName).toBeNull();
  });

  it("unpinStream leaves active alone when unpinning a non-active stream", () => {
    const s = useEventStreamsStore.getState();
    s.pinStream("spindle");
    s.pinStream("ripple");
    useEventStreamsStore.getState().unpinStream("ripple");
    expect(useEventStreamsStore.getState().activeStreamName).toBe("spindle");
  });

  it("setCoincidenceWindow clamps non-finite to 0 and rejects negatives", () => {
    const { setCoincidenceWindow } = useEventStreamsStore.getState();
    setCoincidenceWindow(0.25);
    expect(useEventStreamsStore.getState().coincidenceWindow).toBe(0.25);
    setCoincidenceWindow(NaN);
    expect(useEventStreamsStore.getState().coincidenceWindow).toBe(0);
    setCoincidenceWindow(-1);
    expect(useEventStreamsStore.getState().coincidenceWindow).toBe(0);
  });

  it("ensureActive pins the default stream once and is a no-op afterwards", () => {
    const s = useEventStreamsStore.getState();
    s.ensureActive("spindle");
    expect(useEventStreamsStore.getState().pinnedStreams).toEqual(["spindle"]);
    expect(useEventStreamsStore.getState().activeStreamName).toBe("spindle");
    // Second call with a different default must not overwrite the user's
    // pin set — only the *initial* bootstrap fires.
    s.ensureActive("ripple");
    expect(useEventStreamsStore.getState().pinnedStreams).toEqual(["spindle"]);
    expect(useEventStreamsStore.getState().activeStreamName).toBe("spindle");
  });

  it("ensureActive is a no-op when given a null default", () => {
    useEventStreamsStore.getState().ensureActive(null);
    expect(useEventStreamsStore.getState().pinnedStreams).toEqual([]);
    expect(useEventStreamsStore.getState().activeStreamName).toBeNull();
  });
});
