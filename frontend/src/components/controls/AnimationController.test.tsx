// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AnimationController } from "./AnimationController";
import { useSelectionStore } from "../../store/selectionStore";

beforeEach(() => {
  useSelectionStore.setState({
    timeCursor: 5,
    timeWindow: [0, 10],
    hasInitialized: true,
    spatial: { ap: 0, ml: 0, channel: null, hoveredId: null, selectedIds: [] },
    freq: { freq: 0 },
    event: { eventId: null, streamName: null },
  });
});
afterEach(() => cleanup());

const cursor = () => useSelectionStore.getState().timeCursor;

describe("AnimationController — step semantics (Phase C)", () => {
  it("steps one frame (1/fps) forward, independent of speed", () => {
    render(<AnimationController timeRange={[0, 100]} fps={10} />);
    fireEvent.click(screen.getByTitle("Step forward"));
    expect(cursor()).toBeCloseTo(5.1); // 1/fps = 0.1

    // Change speed to 4× — a step must STILL be one frame (0.1), not 0.4.
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "4" } });
    fireEvent.click(screen.getByTitle("Step forward"));
    expect(cursor()).toBeCloseTo(5.2);
  });

  it("steps one frame backward and clamps at the lower bound", () => {
    render(<AnimationController timeRange={[0, 100]} fps={10} />);
    fireEvent.click(screen.getByTitle("Step back"));
    expect(cursor()).toBeCloseTo(4.9);
  });

  it("step back clamps at timeRange[0]", () => {
    useSelectionStore.setState({ timeCursor: 0.05 });
    render(<AnimationController timeRange={[0, 100]} fps={10} />);
    fireEvent.click(screen.getByTitle("Step back"));
    expect(cursor()).toBe(0);
  });

  it("step forward clamps at timeRange[1]", () => {
    useSelectionStore.setState({ timeCursor: 99.95, timeWindow: [95, 100] });
    render(<AnimationController timeRange={[0, 100]} fps={10} />);
    fireEvent.click(screen.getByTitle("Step forward"));
    expect(cursor()).toBe(100);
  });
});
