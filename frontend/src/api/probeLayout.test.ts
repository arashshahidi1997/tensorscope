import { describe, it, expect } from "vitest";
import { buildRegionResolver } from "./probeLayout";
import type { ProbeLayoutDTO } from "./types";

describe("buildRegionResolver", () => {
  it("returns an empty sentinel when no layout is supplied", () => {
    const r = buildRegionResolver(null, 4);
    expect(r.isEmpty).toBe(true);
    expect(r.regionByFlatId.size).toBe(0);
    expect(r.regionByChannel.size).toBe(0);
  });

  it("indexes electrodes by both channel id and flat (ap,ml) id", () => {
    const layout: ProbeLayoutDTO = {
      n_channels: 4,
      electrodes: [
        { region: "M2", channel_id: 0, ap: 0, ml: 0, label: "ch0" },
        { region: "M2", channel_id: 1, ap: 0, ml: 1, label: null },
        { region: "S1", channel_id: 2, ap: 1, ml: 0, label: null },
        { region: "S1", channel_id: 3, ap: 1, ml: 1, label: "ch3" },
      ],
    };
    const r = buildRegionResolver(layout, 2);
    expect(r.isEmpty).toBe(false);
    expect(r.regionByChannel.get(0)).toBe("M2");
    expect(r.regionByChannel.get(3)).toBe("S1");
    // Flat id = ap*nML + ml
    expect(r.regionByFlatId.get(0)).toBe("M2"); // (0,0)
    expect(r.regionByFlatId.get(1)).toBe("M2"); // (0,1)
    expect(r.regionByFlatId.get(2)).toBe("S1"); // (1,0)
    expect(r.regionByFlatId.get(3)).toBe("S1"); // (1,1)
  });

  it("assigns a distinct palette color per region in insertion order", () => {
    const layout: ProbeLayoutDTO = {
      n_channels: 3,
      electrodes: [
        { region: "M2", channel_id: 0, ap: null, ml: null, label: null },
        { region: "S1", channel_id: 1, ap: null, ml: null, label: null },
        { region: "M2", channel_id: 2, ap: null, ml: null, label: null },
      ],
    };
    const r = buildRegionResolver(layout, 0);
    expect(r.palette.size).toBe(2);
    const m2 = r.palette.get("M2");
    const s1 = r.palette.get("S1");
    expect(m2).toBeTruthy();
    expect(s1).toBeTruthy();
    expect(m2).not.toBe(s1);
  });

  it("ignores entries without ap/ml when nML is unknown", () => {
    const layout: ProbeLayoutDTO = {
      n_channels: 2,
      electrodes: [
        { region: "M2", channel_id: 0, ap: null, ml: null, label: null },
        { region: "S1", channel_id: 1, ap: null, ml: null, label: null },
      ],
    };
    const r = buildRegionResolver(layout, 0);
    expect(r.regionByFlatId.size).toBe(0);
    expect(r.regionByChannel.size).toBe(2);
    expect(r.isEmpty).toBe(false); // channel lookups still valid
  });
});
