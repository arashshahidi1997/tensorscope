// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TimeseriesNavStrip } from "./TimeseriesNavStrip";

afterEach(() => cleanup());

function setup(overrides: Partial<Parameters<typeof TimeseriesNavStrip>[0]> = {}) {
  const onCursorChange = vi.fn();
  const onWindowChange = vi.fn();
  const props = {
    dataRange: [0, 100] as [number, number],
    window: [10, 12] as [number, number], // width 2
    cursor: 11,
    onCursorChange,
    onWindowChange,
    ...overrides,
  };
  const utils = render(<TimeseriesNavStrip {...props} />);
  return { onCursorChange, onWindowChange, props, ...utils };
}

const timeField = () => screen.getByLabelText("Time (s)") as HTMLInputElement;
const windowField = () => screen.getByLabelText("Window (s)") as HTMLInputElement;

describe("TimeseriesNavStrip — focus-aware fields (Phase B)", () => {
  it("does not clobber the Time field mid-edit when the cursor ticks externally", () => {
    const { rerender, props } = setup();
    const input = timeField();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "55.5" } });
    rerender(<TimeseriesNavStrip {...props} cursor={11.04} />); // animation tick
    expect(input.value).toBe("55.5");
  });

  it("syncs the Time field from the cursor when not focused", () => {
    const { rerender, props } = setup();
    rerender(<TimeseriesNavStrip {...props} cursor={42} />);
    expect(timeField().value).toBe("42.000");
  });

  it("does not clobber the Window field mid-edit when the window changes externally", () => {
    const { rerender, props } = setup();
    const input = windowField();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "8" } });
    rerender(<TimeseriesNavStrip {...props} window={[10, 14]} />); // external zoom
    expect(input.value).toBe("8");
  });
});

describe("TimeseriesNavStrip — commit semantics", () => {
  it("Time commit moves the cursor and recenters the window at the current width", () => {
    const { onCursorChange, onWindowChange } = setup(); // width 2, cursor 11
    const input = timeField();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "50" } });
    fireEvent.blur(input);
    expect(onCursorChange).toHaveBeenCalledWith(50);
    // width preserved (2), centered on 50
    const [w] = onWindowChange.mock.calls.at(-1)!;
    expect(w[0]).toBeCloseTo(49);
    expect(w[1]).toBeCloseTo(51);
  });

  it("Window commit resizes (clamped to the data extent)", () => {
    const { onWindowChange } = setup();
    const input = windowField();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "20" } });
    fireEvent.blur(input);
    const [w] = onWindowChange.mock.calls.at(-1)!;
    expect(w[1] - w[0]).toBeCloseTo(20);
  });

  it("ignores non-finite / non-positive input", () => {
    const { onCursorChange, onWindowChange } = setup();
    fireEvent.focus(timeField());
    fireEvent.change(timeField(), { target: { value: "" } });
    fireEvent.blur(timeField());
    fireEvent.focus(windowField());
    fireEvent.change(windowField(), { target: { value: "-3" } });
    fireEvent.blur(windowField());
    expect(onCursorChange).not.toHaveBeenCalled();
    expect(onWindowChange).not.toHaveBeenCalled();
  });
});
