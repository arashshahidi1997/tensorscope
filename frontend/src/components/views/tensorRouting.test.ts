import { describe, expect, it } from "vitest";
import { resolveTensorForSlot } from "./useWorkspaceData";

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
