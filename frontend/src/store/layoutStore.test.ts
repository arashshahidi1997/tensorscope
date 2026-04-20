// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { useLayoutStore } from "./layoutStore";
import type { ViewGridLayout } from "./layoutStore";

const getStore = () => useLayoutStore.getState();

beforeEach(() => {
  window.localStorage.clear();
  useLayoutStore.setState({
    sidebarWidth: 260,
    sidebarCollapsed: false,
    activeSidebarTab: "explore",
    inspectorWidth: 260,
    inspectorCollapsed: false,
    bottomPanelHeight: 120,
    bottomPanelCollapsed: false,
    viewGridLayout: null,
    maximizedView: null,
    activePreset: null,
  });
});

describe("sidebar width clamp", () => {
  it("clamps within [240, 480]", () => {
    getStore().setSidebarWidth(100);
    expect(getStore().sidebarWidth).toBe(240);
    getStore().setSidebarWidth(600);
    expect(getStore().sidebarWidth).toBe(480);
    getStore().setSidebarWidth(300);
    expect(getStore().sidebarWidth).toBe(300);
  });

  it("clears activePreset on any manual resize", () => {
    useLayoutStore.setState({ activePreset: "focus" });
    getStore().setSidebarWidth(300);
    expect(getStore().activePreset).toBeNull();
  });
});

describe("inspector width clamp", () => {
  it("clamps within [200, 500]", () => {
    getStore().setInspectorWidth(50);
    expect(getStore().inspectorWidth).toBe(200);
    getStore().setInspectorWidth(9999);
    expect(getStore().inspectorWidth).toBe(500);
  });
});

describe("bottom panel height clamp", () => {
  it("clamps to at least the 100px floor", () => {
    getStore().setBottomPanelHeight(10);
    expect(getStore().bottomPanelHeight).toBe(100);
  });
});

describe("toggleSidebar / toggleInspector / toggleBottomPanel", () => {
  it("flips the collapsed flag", () => {
    expect(getStore().sidebarCollapsed).toBe(false);
    getStore().toggleSidebar();
    expect(getStore().sidebarCollapsed).toBe(true);
    getStore().toggleInspector();
    expect(getStore().inspectorCollapsed).toBe(true);
    getStore().toggleBottomPanel();
    expect(getStore().bottomPanelCollapsed).toBe(true);
  });
});

describe("setActiveSidebarTab", () => {
  it("switching to a different tab uncollapses and stores the tab", () => {
    useLayoutStore.setState({ activeSidebarTab: "explore", sidebarCollapsed: true });
    getStore().setActiveSidebarTab("graph");
    expect(getStore().activeSidebarTab).toBe("graph");
    expect(getStore().sidebarCollapsed).toBe(false);
  });

  it("clicking the active tab toggles the sidebar collapse state", () => {
    useLayoutStore.setState({ activeSidebarTab: "explore", sidebarCollapsed: false });
    getStore().setActiveSidebarTab("explore");
    expect(getStore().sidebarCollapsed).toBe(true);
    expect(getStore().activeSidebarTab).toBe("explore");
    // Click again → expands
    getStore().setActiveSidebarTab("explore");
    expect(getStore().sidebarCollapsed).toBe(false);
  });
});

describe("maximize view", () => {
  it("setMaximizedView assigns and clears", () => {
    getStore().setMaximizedView("timeseries");
    expect(getStore().maximizedView).toBe("timeseries");
    getStore().setMaximizedView(null);
    expect(getStore().maximizedView).toBeNull();
  });

  it("toggleMaximizeView toggles on and off for the same view", () => {
    getStore().toggleMaximizeView("timeseries");
    expect(getStore().maximizedView).toBe("timeseries");
    getStore().toggleMaximizeView("timeseries");
    expect(getStore().maximizedView).toBeNull();
  });

  it("toggleMaximizeView switches target when a different view is toggled", () => {
    getStore().toggleMaximizeView("timeseries");
    getStore().toggleMaximizeView("spatial_map");
    expect(getStore().maximizedView).toBe("spatial_map");
  });
});

describe("applyPreset", () => {
  const grid: ViewGridLayout = {
    columns: 2,
    rows: 1,
    cells: [{ viewId: "timeseries", row: 0, col: 0 }],
    colWidths: [0.5, 0.5],
    rowHeights: [1],
  };

  it("applies all preset fields and records activePreset", () => {
    useLayoutStore.setState({ maximizedView: "spatial_map" });
    getStore().applyPreset(
      {
        sidebarWidth: 999, // will clamp to 480
        sidebarCollapsed: true,
        activeSidebarTab: "graph",
        inspectorWidth: 50, // will clamp to 200
        inspectorCollapsed: true,
        bottomPanelHeight: 50, // will clamp to 100
        bottomPanelCollapsed: true,
        viewGridLayout: grid,
      },
      "focus",
    );
    const s = getStore();
    expect(s.sidebarWidth).toBe(480);
    expect(s.inspectorWidth).toBe(200);
    expect(s.bottomPanelHeight).toBe(100);
    expect(s.activeSidebarTab).toBe("graph");
    expect(s.viewGridLayout).toEqual(grid);
    expect(s.activePreset).toBe("focus");
    // applyPreset clears any maximized view
    expect(s.maximizedView).toBeNull();
  });
});
