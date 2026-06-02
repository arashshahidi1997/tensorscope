// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ViewPanel } from "./ViewPanel";

afterEach(() => cleanup());

function setup(overrides: Partial<Parameters<typeof ViewPanel>[0]> = {}) {
  const props = {
    viewId: "timeseries",
    label: "Timeseries",
    isMaximized: false,
    onToggleMaximize: vi.fn(),
    onClose: vi.fn(),
    tensorName: "lfp",
    isPinned: false,
    tensorNames: ["lfp"],
    onSetTensor: vi.fn(),
    onClearTensor: vi.fn(),
    children: <div data-testid="panel-body" />,
    ...overrides,
  };
  return render(<ViewPanel {...props} />);
}

describe("ViewPanel — staleness/error badges (refactor-plan N2)", () => {
  it("renders neither badge by default", () => {
    setup();
    expect(screen.queryByText("error")).toBeNull();
    expect(screen.queryByText("stale")).toBeNull();
  });

  it("renders the error badge when isError is true", () => {
    setup({ isError: true });
    const badge = screen.getByText("error");
    expect(badge).not.toBeNull();
    expect(badge.className).toContain("panel-badge--error");
    expect(badge.getAttribute("role")).toBe("status");
  });

  it("renders the stale badge when isStale is true and isError is false", () => {
    setup({ isStale: true });
    const badge = screen.getByText("stale");
    expect(badge).not.toBeNull();
    expect(badge.className).toContain("panel-badge--stale");
  });

  it("prefers the error badge over the stale badge when both are true", () => {
    // A failed refetch is both "stale" (placeholder data on screen) and
    // "error" (last attempt to refresh failed). We surface the stronger
    // signal — error — and suppress the redundant stale badge.
    setup({ isError: true, isStale: true });
    expect(screen.queryByText("error")).not.toBeNull();
    expect(screen.queryByText("stale")).toBeNull();
  });

  it("can show the loading indicator alongside the stale badge", () => {
    // Mid-refetch: placeholder data on screen + fetch in flight.
    setup({ isStale: true, isFetching: true });
    expect(screen.queryByText("stale")).not.toBeNull();
    expect(screen.queryByText(/loading/i)).not.toBeNull();
  });
});
