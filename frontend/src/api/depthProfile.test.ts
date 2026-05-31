// @vitest-environment node
import { describe, expect, it } from "vitest";
import { extractDepthProfile, type DecodedSlice } from "./arrow";

function decoded(rows: Array<Record<string, unknown>>, columns: string[]): DecodedSlice {
  return { columns, rows };
}

describe("extractDepthProfile", () => {
  it("orders channels dorsal→ventral by depth and lays out a single column", () => {
    // Channels intentionally out of depth order to prove sorting by `depth`.
    const d = decoded(
      [
        { channel: 0, value: 10, depth: 700 },
        { channel: 1, value: 20, depth: 0 },
        { channel: 2, value: 30, depth: 350 },
      ],
      ["channel", "value", "depth"],
    );
    const cells = extractDepthProfile(d);
    expect(cells).toHaveLength(3);
    // All in one column.
    expect(cells.every((c) => c.ml === 0)).toBe(true);
    // ap is the 0-based depth rank: depth 0 → ap 0, 350 → ap 1, 700 → ap 2.
    expect(cells.map((c) => c.ap)).toEqual([0, 1, 2]);
    // Values follow the depth order (ch1=20 @0, ch2=30 @350, ch0=10 @700).
    expect(cells.map((c) => c.value)).toEqual([20, 30, 10]);
  });

  it("averages duplicate channel rows", () => {
    const d = decoded(
      [
        { channel: 0, value: 10, depth: 0 },
        { channel: 0, value: 20, depth: 0 },
      ],
      ["channel", "value", "depth"],
    );
    const cells = extractDepthProfile(d);
    expect(cells).toHaveLength(1);
    expect(cells[0].value).toBe(15);
  });

  it("falls back to channel order when no depth column is present", () => {
    const d = decoded(
      [
        { channel: 2, value: 30 },
        { channel: 0, value: 10 },
        { channel: 1, value: 20 },
      ],
      ["channel", "value"],
    );
    const cells = extractDepthProfile(d);
    expect(cells.map((c) => c.value)).toEqual([10, 20, 30]);
    expect(cells.map((c) => c.ap)).toEqual([0, 1, 2]);
  });

  it("returns [] when required columns are missing", () => {
    expect(extractDepthProfile(decoded([], ["value"]))).toEqual([]);
    expect(extractDepthProfile(decoded([], ["channel"]))).toEqual([]);
  });
});
