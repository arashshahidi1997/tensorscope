// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { useMaskStore } from "./maskStore";

const getStore = () => useMaskStore.getState();

beforeEach(() => {
  window.localStorage.clear();
  useMaskStore.setState({ masks: {} });
});

describe("setMask", () => {
  it("stores a sorted, deduplicated id list", () => {
    getStore().setMask("lfp", [3, 1, 1, 5, 0]);
    expect(getStore().masks.lfp).toEqual([0, 1, 3, 5]);
  });

  it("drops the entry entirely when ids is empty", () => {
    getStore().setMask("lfp", [1, 2]);
    getStore().setMask("lfp", []);
    expect("lfp" in getStore().masks).toBe(false);
  });
});

describe("toggleId", () => {
  it("adds an id when missing and removes it when present", () => {
    getStore().toggleId("lfp", 5);
    expect(getStore().masks.lfp).toEqual([5]);
    getStore().toggleId("lfp", 5);
    expect("lfp" in getStore().masks).toBe(false);
  });

  it("preserves sort order across toggles", () => {
    getStore().toggleId("lfp", 7);
    getStore().toggleId("lfp", 2);
    getStore().toggleId("lfp", 4);
    expect(getStore().masks.lfp).toEqual([2, 4, 7]);
  });
});

describe("toggleRow", () => {
  it("masks the entire AP row when no cells in it are masked", () => {
    // 4×4 grid, ap=2, nML=4 → row ids = [8, 9, 10, 11]
    getStore().toggleRow("lfp", 2, 4);
    expect(getStore().masks.lfp).toEqual([8, 9, 10, 11]);
  });

  it("unmasks the entire AP row when all cells are already masked", () => {
    getStore().toggleRow("lfp", 1, 4); // ids = [4,5,6,7]
    expect(getStore().masks.lfp).toEqual([4, 5, 6, 7]);
    getStore().toggleRow("lfp", 1, 4);
    expect("lfp" in getStore().masks).toBe(false);
  });

  it("masks the rest of the row if it's only partially masked", () => {
    getStore().setMask("lfp", [4]); // partial: only (ap=1, ml=0) masked
    getStore().toggleRow("lfp", 1, 4);
    expect(getStore().masks.lfp).toEqual([4, 5, 6, 7]);
  });
});

describe("toggleCol", () => {
  it("masks the entire ML column when no cells in it are masked", () => {
    // 4×4 grid, ml=2, nAP=4 → col ids = [2, 6, 10, 14]
    getStore().toggleCol("lfp", 2, 4, 4);
    expect(getStore().masks.lfp).toEqual([2, 6, 10, 14]);
  });

  it("unmasks the entire ML column when all cells are already masked", () => {
    getStore().toggleCol("lfp", 0, 4, 4); // ids = [0,4,8,12]
    expect(getStore().masks.lfp).toEqual([0, 4, 8, 12]);
    getStore().toggleCol("lfp", 0, 4, 4);
    expect("lfp" in getStore().masks).toBe(false);
  });
});

describe("invertMask", () => {
  it("returns the complement of the current mask within [0, total)", () => {
    getStore().setMask("lfp", [0, 2, 4]);
    getStore().invertMask("lfp", 5);
    expect(getStore().masks.lfp).toEqual([1, 3]);
  });

  it("clears the entry when the inverted set would be empty", () => {
    getStore().setMask("lfp", [0, 1, 2, 3]);
    getStore().invertMask("lfp", 4);
    expect("lfp" in getStore().masks).toBe(false);
  });
});

describe("setInteriorOnly", () => {
  it("masks the outer ring on a 4x4 grid (ringDepth=1)", () => {
    getStore().setInteriorOnly("lfp", 4, 4, 1);
    // The outer ring on a 4x4 grid is everything except the inner 2x2.
    // Inner 2x2 is (1,1), (1,2), (2,1), (2,2) → flat ids 5, 6, 9, 10.
    // So the masked set is everything else: 16 - 4 = 12 ids.
    const ids = getStore().masks.lfp;
    expect(ids).toHaveLength(12);
    expect(ids).not.toContain(5);
    expect(ids).not.toContain(6);
    expect(ids).not.toContain(9);
    expect(ids).not.toContain(10);
  });
});

describe("getMaskedSet", () => {
  it("returns a Set view of the current mask", () => {
    getStore().setMask("lfp", [1, 4, 9]);
    const s = getStore().getMaskedSet("lfp");
    expect(s.has(4)).toBe(true);
    expect(s.has(2)).toBe(false);
    expect(s.size).toBe(3);
  });

  it("returns an empty set for unknown tensor", () => {
    expect(getStore().getMaskedSet("missing").size).toBe(0);
  });
});

describe("persistence", () => {
  it("persists mask state to localStorage under tensorscope:masks:v1", () => {
    getStore().setMask("lfp", [0, 1, 2]);
    const raw = window.localStorage.getItem("tensorscope:masks:v1");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.state.masks.lfp).toEqual([0, 1, 2]);
  });
});
