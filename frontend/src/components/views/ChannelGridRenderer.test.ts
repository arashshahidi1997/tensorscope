// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { ChannelGridRenderer } from "./ChannelGridRenderer";
import type { SpatialCellWithId } from "./SpatialRenderer";

/**
 * Wire a renderer up to a stub 2D context so we can inspect what paint
 * primitives the G7 region overlay adds. We don't need the canvas to
 * actually pixel-render — only that `fill()` is called once per
 * annotated cell on top of the baseline value paint.
 */
function makeRendererWithStubCtx(w = 32, h = 32): {
  renderer: ChannelGridRenderer;
  ctx: Record<string, unknown> & { fill: ReturnType<typeof vi.fn>; getOps: () => string[] };
} {
  const ops: string[] = [];
  const noop = () => {};
  // A bare-bones CanvasRenderingContext2D stub.
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    canvas: { width: w, height: h },
    save: vi.fn(() => ops.push("save")),
    restore: vi.fn(() => ops.push("restore")),
    beginPath: vi.fn(() => ops.push("beginPath")),
    closePath: vi.fn(() => ops.push("closePath")),
    moveTo: vi.fn(() => ops.push("moveTo")),
    lineTo: vi.fn(() => ops.push("lineTo")),
    arc: noop,
    fill: vi.fn(() => ops.push("fill")),
    stroke: vi.fn(() => ops.push("stroke")),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    clearRect: vi.fn(),
    createImageData: vi.fn((w: number, h: number) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(w * h * 4),
    })),
    putImageData: vi.fn(),
    drawImage: vi.fn(),
    setLineDash: vi.fn(),
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "high",
    getOps: () => ops,
  };
  const canvas = document.createElement("canvas");
  vi.spyOn(canvas, "getContext").mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  const renderer = new ChannelGridRenderer();
  renderer.init(canvas, w, h);
  return { renderer, ctx };
}

function makeCells(nAP: number, nML: number): SpatialCellWithId[] {
  const cells: SpatialCellWithId[] = [];
  for (let ap = 0; ap < nAP; ap++) {
    for (let ml = 0; ml < nML; ml++) {
      cells.push({
        id: ap * nML + ml,
        apIdx: ap,
        mlIdx: ml,
        value: ap + ml,
      });
    }
  }
  return cells;
}

describe("ChannelGridRenderer — G7 region overlay", () => {
  it("paints one filled triangle per annotated cell", () => {
    const { renderer, ctx } = makeRendererWithStubCtx();
    const cells = makeCells(2, 2);
    const regionByFlatId = new Map<number, string>([
      [0, "M2"],
      [1, "M2"],
      [2, "S1"],
      // Cell 3 intentionally left unannotated.
    ]);
    const regionPalette = new Map<string, string>([
      ["M2", "#7dd3fc"],
      ["S1", "#fca5a5"],
    ]);

    renderer.render(cells, {
      nAP: 2,
      nML: 2,
      colorScale: "sequential",
      hoveredId: null,
      selectedIds: [],
      minValue: 0,
      maxValue: 2,
      colormap: "viridis",
      regionByFlatId,
      regionPalette,
    });

    expect(ctx.fill).toHaveBeenCalledTimes(3);
  });

  it("paints no extra triangles when no region map is supplied", () => {
    const { renderer, ctx } = makeRendererWithStubCtx();
    renderer.render(makeCells(2, 2), {
      nAP: 2,
      nML: 2,
      colorScale: "sequential",
      hoveredId: null,
      selectedIds: [],
      minValue: 0,
      maxValue: 2,
      colormap: "viridis",
    });
    expect(ctx.fill).toHaveBeenCalledTimes(0);
  });
});

describe("ChannelGridRenderer — equal-aspect (squareCells)", () => {
  const opts = (squareCells: boolean) => ({
    nAP: 2,
    nML: 2,
    colorScale: "sequential" as const,
    hoveredId: null,
    selectedIds: [],
    minValue: 0,
    maxValue: 2,
    colormap: "viridis" as const,
    squareCells,
  });

  it("makes cells square + centers the grid on a non-square canvas", () => {
    // 40×20 canvas, 2×2 grid → square cell = min(40/2, 20/2) = 10; grid is
    // 20×20, letterboxed to x∈[10,30], y∈[0,20].
    const { renderer } = makeRendererWithStubCtx(40, 20);
    renderer.render(makeCells(2, 2), opts(true));
    // Inside the centered grid: (15,5) → col 0,row 0; (25,15) → col 1,row 1.
    expect(renderer.hitTest(15, 5)).toBe(0);
    expect(renderer.hitTest(25, 15)).toBe(3); // ap1*nML + ml1 = 3
    // The left letterbox margin (x<10) has no cell.
    expect(renderer.hitTest(5, 5)).toBeNull();
    expect(renderer.hitTest(35, 5)).toBeNull(); // right margin (x>30)
  });

  it("stretches to fill (offset 0) when squareCells is off — legacy behaviour", () => {
    const { renderer } = makeRendererWithStubCtx(40, 20);
    renderer.render(makeCells(2, 2), opts(false));
    // cellW=20, cellH=10, no offset → (5,5) maps to col 0,row 0; full canvas used.
    expect(renderer.hitTest(5, 5)).toBe(0);
    expect(renderer.hitTest(35, 15)).toBe(3);
  });
});
