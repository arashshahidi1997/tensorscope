import { describe, expect, it } from "vitest";
import { resolveTensorForSlot } from "./useWorkspaceData";
import { PROBE_LANES_LAYOUT, slotKey } from "./viewGridLayout";
import { PROBE_LANES_OVERRIDES } from "../../store/appStore";

describe("resolveTensorForSlot (Track C1 per-slot tensor routing)", () => {
  it("returns the global tensor when the slot has no override", () => {
    expect(resolveTensorForSlot({}, "ecog", "timeseries")).toBe("ecog");
    expect(resolveTensorForSlot({ spatial_map: "neuropixels" }, "ecog", "timeseries")).toBe("ecog");
  });

  it("returns the per-slot override when present", () => {
    const overrides = { timeseries: "neuropixels" };
    // The overridden slot routes to neuropixels; every other slot stays global.
    expect(resolveTensorForSlot(overrides, "ecog", "timeseries")).toBe("neuropixels");
    expect(resolveTensorForSlot(overrides, "ecog", "spectrogram_live")).toBe("ecog");
    expect(resolveTensorForSlot(overrides, "ecog", "depth_map")).toBe("ecog");
  });

  it("propagates a null global tensor when no override applies", () => {
    expect(resolveTensorForSlot({}, null, "timeseries")).toBeNull();
    // An override still wins even when the global tensor is null.
    expect(resolveTensorForSlot({ depth_map: "neuropixels" }, null, "depth_map")).toBe("neuropixels");
  });
});

describe("probe-lanes layout (Track C2/C3)", () => {
  it("renders the same view type twice via distinct slot keys", () => {
    const allSlots = PROBE_LANES_LAYOUT.rows.flatMap((r) => r.slots);
    const timeseriesSlots = allSlots.filter((s) => s.viewId === "timeseries");
    const specSlots = allSlots.filter((s) => s.viewId === "spectrogram_live");
    // Two timeseries lanes + two spectrogram lanes, each with a UNIQUE slot key.
    expect(timeseriesSlots.map(slotKey).sort()).toEqual(["timeseries", "timeseries_npx"]);
    expect(specSlots.map(slotKey).sort()).toEqual(["spectrogram_live", "spectrogram_npx"]);
    // Every slot key in the layout is unique (no collisions).
    const keys = allSlots.map(slotKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("the two timeseries lanes resolve to distinct tensors (C2 acceptance)", () => {
    // ecog lane keeps the global tensor; the _npx lane routes to neuropixels.
    expect(resolveTensorForSlot(PROBE_LANES_OVERRIDES, "ecog", "timeseries")).toBe("ecog");
    expect(resolveTensorForSlot(PROBE_LANES_OVERRIDES, "ecog", "timeseries_npx")).toBe("neuropixels");
    expect(resolveTensorForSlot(PROBE_LANES_OVERRIDES, "ecog", "spectrogram_live")).toBe("ecog");
    expect(resolveTensorForSlot(PROBE_LANES_OVERRIDES, "ecog", "spectrogram_npx")).toBe("neuropixels");
    expect(resolveTensorForSlot(PROBE_LANES_OVERRIDES, "ecog", "depth_map")).toBe("neuropixels");
  });
});
