// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TimeScaleBar } from "./ChartToolbar";

afterEach(() => cleanup());

const timeInput = () => screen.getByTitle("Jump to time (seconds)") as HTMLInputElement;

describe("TimeScaleBar — time input commit semantics (Phase B)", () => {
  it("does NOT clobber an in-progress edit when the cursor changes externally", () => {
    const { rerender } = render(<TimeScaleBar timeCursor={1} />);
    const input = timeInput();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "12.5" } });
    // External cursor tick (e.g. animation / paired commit) while focused:
    rerender(<TimeScaleBar timeCursor={3.001} />);
    expect(input.value).toBe("12.5"); // edit survives
  });

  it("DOES sync the field from the cursor while not focused", () => {
    const { rerender } = render(<TimeScaleBar timeCursor={1} />);
    rerender(<TimeScaleBar timeCursor={7.25} />);
    expect(timeInput().value).toBe("7.250"); // formatSeconds = toFixed(3)
  });

  it("commits exactly once on Enter (Enter blurs → single onJumpToTime)", () => {
    const onJumpToTime = vi.fn();
    render(<TimeScaleBar timeCursor={0} onJumpToTime={onJumpToTime} />);
    const input = timeInput();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "42" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input); // jsdom does not auto-blur on Enter; emulate the blur Enter triggers
    expect(onJumpToTime).toHaveBeenCalledTimes(1);
    expect(onJumpToTime).toHaveBeenCalledWith(42);
  });

  it("ignores non-finite input", () => {
    const onJumpToTime = vi.fn();
    render(<TimeScaleBar timeCursor={0} onJumpToTime={onJumpToTime} />);
    const input = timeInput();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.blur(input);
    expect(onJumpToTime).not.toHaveBeenCalled();
  });
});

describe("TimeScaleBar — preset pill highlight (epsilon, not float ===)", () => {
  it("highlights the matching preset even when width carries float drift", () => {
    // 0.0999999 should still light up the 100 ms pill.
    render(<TimeScaleBar timeCursor={0} viewportDuration={0.1 - 1e-9} />);
    const pill = screen.getByTitle("Set window to 100ms");
    expect(pill.className).toContain("active");
  });

  it("does not highlight a non-matching width", () => {
    render(<TimeScaleBar timeCursor={0} viewportDuration={0.37} />);
    const pill = screen.getByTitle("Set window to 100ms");
    expect(pill.className).not.toContain("active");
  });

  it("preset click reports the duration in seconds", () => {
    const onViewportDurationChange = vi.fn();
    render(
      <TimeScaleBar
        timeCursor={5}
        viewportDuration={1}
        onViewportDurationChange={onViewportDurationChange}
      />,
    );
    fireEvent.click(screen.getByTitle("Set window to 100ms"));
    expect(onViewportDurationChange).toHaveBeenCalledWith(0.1);
  });
});
