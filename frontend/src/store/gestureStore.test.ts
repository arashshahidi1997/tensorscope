// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { hasInspector, useGestureStore } from "./gestureStore";

function reset(): void {
  useGestureStore.setState({
    drag: "box_zoom",
    scroll: "wheel_zoom",
    inspectors: ["crosshair"],
  });
}

describe("gestureStore", () => {
  beforeEach(() => {
    reset();
    window.localStorage?.removeItem?.("tensorscope:gestures");
  });

  it("drag is mutually exclusive — setDrag replaces, never accumulates", () => {
    const s = useGestureStore.getState();
    s.setDrag("pan");
    expect(useGestureStore.getState().drag).toBe("pan");
    s.setDrag("box_select");
    expect(useGestureStore.getState().drag).toBe("box_select");
  });

  it("scroll is mutually exclusive — setScroll replaces", () => {
    const s = useGestureStore.getState();
    s.setScroll("off");
    expect(useGestureStore.getState().scroll).toBe("off");
    s.setScroll("wheel_zoom");
    expect(useGestureStore.getState().scroll).toBe("wheel_zoom");
  });

  it("inspectors stack — multiple can be on at once", () => {
    const s = useGestureStore.getState();
    s.toggleInspector("hover");
    expect(hasInspector(useGestureStore.getState().inspectors, "crosshair")).toBe(true);
    expect(hasInspector(useGestureStore.getState().inspectors, "hover")).toBe(true);
  });

  it("toggleInspector is its own inverse", () => {
    const s = useGestureStore.getState();
    s.toggleInspector("crosshair");
    expect(hasInspector(useGestureStore.getState().inspectors, "crosshair")).toBe(false);
    s.toggleInspector("crosshair");
    expect(hasInspector(useGestureStore.getState().inspectors, "crosshair")).toBe(true);
  });

  it("setInspectorEnabled is idempotent on both directions", () => {
    const s = useGestureStore.getState();
    s.setInspectorEnabled("hover", true);
    s.setInspectorEnabled("hover", true);
    const insp1 = useGestureStore.getState().inspectors;
    expect(insp1.filter((i) => i === "hover")).toHaveLength(1);
    s.setInspectorEnabled("hover", false);
    s.setInspectorEnabled("hover", false);
    expect(useGestureStore.getState().inspectors).not.toContain("hover");
  });
});
