// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "./appStore";

const getStore = () => useAppStore.getState();

beforeEach(() => {
  window.localStorage.clear();
  useAppStore.setState({
    selectedTensor: null,
    activeViews: [],
    panelTensorOverrides: {},
    layoutDraft: null,
    theme: "plotly-dark",
    brainstateOverlay: true,
    trackVisibility: {},
    workspaceObjects: [],
    objectLayoutMode: "single",
    psdFmax: 100,
    psdNW: 4,
    psdWindowS: 1,
    freqLogScale: false,
    specFmin: 0.5,
    specFmax: 30,
    specNpersegS: 1.0,
  });
});

describe("selectedTensor", () => {
  it("setSelectedTensor resets activeViews and panel overrides", () => {
    useAppStore.setState({
      activeViews: ["timeseries"],
      panelTensorOverrides: { slot1: "lfp" },
    });
    getStore().setSelectedTensor("ripple");
    expect(getStore().selectedTensor).toBe("ripple");
    expect(getStore().activeViews).toEqual([]);
    expect(getStore().panelTensorOverrides).toEqual({});
  });
});

describe("panelTensorOverrides", () => {
  it("setPanelTensor adds an override without touching other slots", () => {
    useAppStore.setState({ panelTensorOverrides: { slotA: "lfp" } });
    getStore().setPanelTensor("slotB", "ripple");
    expect(getStore().panelTensorOverrides).toEqual({ slotA: "lfp", slotB: "ripple" });
  });

  it("clearPanelTensor removes the override for one slot", () => {
    useAppStore.setState({ panelTensorOverrides: { slotA: "lfp", slotB: "ripple" } });
    getStore().clearPanelTensor("slotA");
    expect(getStore().panelTensorOverrides).toEqual({ slotB: "ripple" });
  });
});

describe("toggleView", () => {
  const available = ["timeseries", "spatial_map", "psd_average"];

  it("first toggle switches from implicit 'all' to explicit minus one", () => {
    // activeViews=[] means "all on"; clicking a pill removes that one
    getStore().toggleView("spatial_map", available);
    expect(getStore().activeViews.sort()).toEqual(["psd_average", "timeseries"]);
  });

  it("toggling all back on collapses to empty (= all)", () => {
    useAppStore.setState({ activeViews: ["timeseries", "spatial_map"] });
    // Adding the third makes activeViews.length === availableViews.length → collapse
    getStore().toggleView("psd_average", available);
    expect(getStore().activeViews).toEqual([]);
  });

  it("toggling off an explicit view removes it", () => {
    useAppStore.setState({ activeViews: ["timeseries", "spatial_map"] });
    getStore().toggleView("timeseries", available);
    expect(getStore().activeViews).toEqual(["spatial_map"]);
  });
});

describe("theme", () => {
  it("setTheme persists to localStorage", () => {
    getStore().setTheme("bokeh-dark");
    expect(getStore().theme).toBe("bokeh-dark");
    expect(window.localStorage.getItem("tensorscope-theme")).toBe("bokeh-dark");
  });
});

describe("brainstate + hypnogram toggles", () => {
  it("toggleBrainstateOverlay flips the flag", () => {
    expect(getStore().brainstateOverlay).toBe(true);
    getStore().toggleBrainstateOverlay();
    expect(getStore().brainstateOverlay).toBe(false);
    getStore().toggleBrainstateOverlay();
    expect(getStore().brainstateOverlay).toBe(true);
  });

  it("toggleTrackVisible flips a lane (default visible → hidden → visible)", () => {
    getStore().toggleTrackVisible("speed");
    expect(getStore().trackVisibility.speed).toBe(false);
    getStore().toggleTrackVisible("speed");
    expect(getStore().trackVisibility.speed).toBe(true);
  });
});

describe("workspaceObjects", () => {
  it("setObjectVisible updates only the matching object", () => {
    useAppStore.setState({
      workspaceObjects: [
        { id: "a", name: "A", tensorName: "lfp", type: "source", visible: true },
        { id: "b", name: "B", tensorName: "ripple", type: "derived", visible: true },
      ],
    });
    getStore().setObjectVisible("b", false);
    const objs = getStore().workspaceObjects;
    expect(objs.find((o) => o.id === "a")!.visible).toBe(true);
    expect(objs.find((o) => o.id === "b")!.visible).toBe(false);
  });
});

describe("PSD settings", () => {
  it("setPsdFmax / setPsdNW / setPsdWindowS update the corresponding fields", () => {
    getStore().setPsdFmax(200);
    getStore().setPsdNW(6);
    getStore().setPsdWindowS(2);
    const s = getStore();
    expect(s.psdFmax).toBe(200);
    expect(s.psdNW).toBe(6);
    expect(s.psdWindowS).toBe(2);
  });

  it("toggleFreqLogScale flips the flag", () => {
    expect(getStore().freqLogScale).toBe(false);
    getStore().toggleFreqLogScale();
    expect(getStore().freqLogScale).toBe(true);
    getStore().toggleFreqLogScale();
    expect(getStore().freqLogScale).toBe(false);
  });
});

describe("Spectrogram settings (A1)", () => {
  it("defaults mirror the server DTO (0.5 / 30 / 1.0)", () => {
    const s = getStore();
    expect(s.specFmin).toBe(0.5);
    expect(s.specFmax).toBe(30);
    expect(s.specNpersegS).toBe(1.0);
  });

  it("setSpecFmin / setSpecFmax / setSpecNpersegS update the corresponding fields", () => {
    // Raising fmax to 250 is what makes ripples viewable in the TF panel.
    getStore().setSpecFmax(250);
    getStore().setSpecFmin(80);
    getStore().setSpecNpersegS(0.25);
    const s = getStore();
    expect(s.specFmax).toBe(250);
    expect(s.specFmin).toBe(80);
    expect(s.specNpersegS).toBe(0.25);
  });
});
