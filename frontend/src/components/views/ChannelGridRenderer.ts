import { getColormapLUT } from "./colormaps";
import type {
  SpatialCellWithId,
  SpatialRenderOptions,
  SpatialRendererBackend,
} from "./SpatialRenderer";

/** Cyclical (phase) colormap — HSL hue rotation, kept for "cyclical" scale. */
function cyclicalRGB(t: number): [number, number, number] {
  const h = t;
  const s = 0.7;
  const l = 0.45;
  // Inline HSL→RGB
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function lookupColor(
  value: number,
  min: number,
  max: number,
  scale: SpatialRenderOptions["colorScale"],
  lut: Uint8ClampedArray,
): [number, number, number] {
  const t = max === min ? 0.5 : Math.max(0, Math.min(1, (value - min) / (max - min)));
  if (scale === "cyclical") return cyclicalRGB(t);
  const idx = Math.round(t * 255) * 4;
  return [lut[idx], lut[idx + 1], lut[idx + 2]];
}

function lookupColorCss(
  value: number,
  min: number,
  max: number,
  scale: SpatialRenderOptions["colorScale"],
  lut: Uint8ClampedArray,
): string {
  const [r, g, b] = lookupColor(value, min, max, scale, lut);
  return `rgb(${r}, ${g}, ${b})`;
}

export class ChannelGridRenderer implements SpatialRendererBackend {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private width = 0;
  private height = 0;
  private cellW = 0;
  private cellH = 0;
  private nAP = 0;
  private nML = 0;
  /** Map from electrode id → its cell rect for hit-testing. */
  private cellMap = new Map<number, { apIdx: number; mlIdx: number }>();

  init(canvas: HTMLCanvasElement, width: number, height: number): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.width = width;
    this.height = height;
  }

  render(cells: SpatialCellWithId[], options: SpatialRenderOptions): void {
    if (!this.ctx || !this.canvas) return;

    const {
      nAP,
      nML,
      colorScale,
      hoveredId,
      selectedIds,
      minValue,
      maxValue,
      maskedIds,
      colormap = "sequential",
      smoothing = false,
      showCellBorders = false,
      regionByFlatId,
      regionPalette,
    } = options;
    this.nAP = nAP;
    this.nML = nML;

    // Audit A2: render the value tiles into an ImageData of native grid
    // resolution (nML × nAP), then drawImage onto the visible canvas. Default
    // is a nearest-neighbor upscale (smoothing=false) — matplotlib `imshow`'s
    // default look: crisp tiles, no visible 1-pixel gaps between cells. Pass
    // smoothing=true for bilinear blending across neighbours.
    this.cellW = this.width / nML;
    this.cellH = this.height / nAP;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    this.cellMap.clear();
    const selectedSet = new Set(selectedIds);
    const maskSet = maskedIds ?? null;
    const lut = getColormapLUT(colormap);

    // Build lookup for masked-aware rendering.
    const cellByPos = new Map<number, SpatialCellWithId>();
    for (const c of cells) cellByPos.set(c.apIdx * nML + c.mlIdx, c);

    // 1. Build the per-cell value image — masked cells are transparent in
    //    this layer (we'll paint the hatch overlay on top), so the smoothing
    //    blit doesn't blend hatched tiles into their neighbours.
    const img = ctx.createImageData(nML, nAP);
    for (let ap = 0; ap < nAP; ap++) {
      for (let ml = 0; ml < nML; ml++) {
        const flatId = ap * nML + ml;
        const isMasked = maskSet ? maskSet.has(flatId) : false;
        const cell = cellByPos.get(flatId);
        const px = (ap * nML + ml) * 4;
        if (isMasked) {
          // Solid neutral fill so a smoothing blit doesn't leak data colour
          // into the masked footprint; the hatched overlay paints on top.
          img.data[px + 0] = 42;  // matches #2a2f36 below
          img.data[px + 1] = 47;
          img.data[px + 2] = 54;
          img.data[px + 3] = 255;
          this.cellMap.set(flatId, { apIdx: ap, mlIdx: ml });
        } else if (cell !== undefined) {
          const [r, g, b] = lookupColor(cell.value, minValue, maxValue, colorScale, lut);
          img.data[px + 0] = r;
          img.data[px + 1] = g;
          img.data[px + 2] = b;
          img.data[px + 3] = 255;
          this.cellMap.set(cell.id, { apIdx: ap, mlIdx: ml });
        } else {
          // No data for this cell — render transparent.
          img.data[px + 3] = 0;
        }
      }
    }

    // 2. Blit to the visible canvas with smoothing if requested. Bitmap path
    //    is the fast way to upscale ImageData with bilinear filtering; older
    //    browsers fall back to drawing the ImageData via an offscreen canvas.
    ctx.imageSmoothingEnabled = smoothing;
    ctx.imageSmoothingQuality = "high";
    if (typeof (globalThis as { createImageBitmap?: unknown }).createImageBitmap === "function") {
      // Sync path: use an offscreen canvas as the source so we don't have
      // to await the createImageBitmap promise inside a synchronous render.
      const off =
        typeof OffscreenCanvas !== "undefined"
          ? new OffscreenCanvas(nML, nAP)
          : (() => {
              const c = document.createElement("canvas");
              c.width = nML;
              c.height = nAP;
              return c;
            })();
      const offCtx = (off as HTMLCanvasElement | OffscreenCanvas).getContext("2d") as
        | CanvasRenderingContext2D
        | OffscreenCanvasRenderingContext2D
        | null;
      if (offCtx) {
        offCtx.putImageData(img, 0, 0);
        ctx.drawImage(off as CanvasImageSource, 0, 0, this.width, this.height);
      }
    } else {
      // Last-resort: putImageData at native res then drawImage upscale via
      // a temp <canvas>. Older spec coverage path. In jsdom (test env)
      // getContext returns null — skip the blit, the value-paint just
      // doesn't render but the rest of the overlay code still does.
      const tmp = document.createElement("canvas");
      tmp.width = nML;
      tmp.height = nAP;
      const tmpCtx = tmp.getContext("2d");
      if (tmpCtx) {
        tmpCtx.putImageData(img, 0, 0);
        ctx.drawImage(tmp, 0, 0, this.width, this.height);
      }
    }

    // 3. Mask hatch overlay + selection / hover decorations + optional
    //    per-cell borders (editor mode) + optional region tab (G7).
    //    Drawn at the upscaled cell pitch so they stay sharp regardless
    //    of smoothing.
    const hasRegionOverlay = !!(regionByFlatId && regionByFlatId.size > 0);
    for (let ap = 0; ap < nAP; ap++) {
      for (let ml = 0; ml < nML; ml++) {
        const flatId = ap * nML + ml;
        const x = ml * this.cellW;
        const y = ap * this.cellH;
        const isMasked = maskSet ? maskSet.has(flatId) : false;
        const cell = cellByPos.get(flatId);

        if (showCellBorders) {
          ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, this.cellW - 1, this.cellH - 1);
        }

        // G7 region tab — a small filled triangle in the top-left corner
        // tinted by region. Sized at min(cellW, cellH) / 3 so it stays
        // visible on small grids but never dominates the cell. Drawn
        // BEFORE the mask hatch / hover / selection strokes so they win
        // any overlap.
        if (hasRegionOverlay) {
          const region = regionByFlatId!.get(flatId);
          if (region) {
            const color = regionPalette?.get(region) ?? "#9aa0a6";
            const tab = Math.max(2, Math.min(this.cellW, this.cellH) / 3);
            ctx.save();
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + tab, y);
            ctx.lineTo(x, y + tab);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
          }
        }

        if (isMasked) {
          ctx.strokeStyle = "#5a6068";
          ctx.lineWidth = 0.5;
          const step = 4;
          ctx.beginPath();
          for (let d = -this.cellH; d < this.cellW; d += step) {
            ctx.moveTo(x + d, y);
            ctx.lineTo(x + d + this.cellH, y + this.cellH);
          }
          ctx.stroke();
        } else if (cell !== undefined) {
          if (selectedSet.has(cell.id)) {
            ctx.strokeStyle = "var(--accent, #4fc)";
            ctx.lineWidth = 2;
            ctx.strokeRect(x + 1, y + 1, this.cellW - 2, this.cellH - 2);
          }
          if (cell.id === hoveredId) {
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 1.5;
            ctx.strokeRect(x + 0.75, y + 0.75, this.cellW - 1.5, this.cellH - 1.5);
          }
        }
      }
    }

    // Keep `colorFor` reachable for any legacy callers reading the module.
    void lookupColorCss;
  }

  hitTest(x: number, y: number): number | null {
    // Audit S13: O(1) hit test from canvas coords. The smoothed render path
    // lays cells out at exact `(width / nML, height / nAP)` pitch with no
    // gap, so the inverse is direct division.
    if (this.nAP === 0 || this.nML === 0 || this.cellW <= 0 || this.cellH <= 0) {
      return null;
    }
    const mlIdx = Math.floor(x / this.cellW);
    const apIdx = Math.floor(y / this.cellH);
    if (mlIdx < 0 || mlIdx >= this.nML || apIdx < 0 || apIdx >= this.nAP) return null;
    return apIdx * this.nML + mlIdx;
  }

  dispose(): void {
    this.canvas = null;
    this.ctx = null;
    this.cellMap.clear();
  }
}
