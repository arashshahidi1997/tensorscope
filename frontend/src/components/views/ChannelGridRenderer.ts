import type {
  SpatialCellWithId,
  SpatialRenderOptions,
  SpatialRendererBackend,
} from "./SpatialRenderer";

/** Map a normalized [0,1] value to an HSL color string for sequential scales. */
function sequentialColor(t: number): string {
  const hue = 220 - t * 160;      // blue (220°) → green (60°)
  const light = 15 + t * 45;      // dark → bright
  return `hsl(${hue} 70% ${light}%)`;
}

/** Map a normalized [0,1] value to an HSL color string for cyclical (phase) scales. */
function cyclicalColor(t: number): string {
  return `hsl(${t * 360} 70% 45%)`;
}

function colorFor(
  value: number,
  min: number,
  max: number,
  scale: SpatialRenderOptions["colorScale"],
): string {
  const t = max === min ? 0.5 : Math.max(0, Math.min(1, (value - min) / (max - min)));
  return scale === "cyclical" ? cyclicalColor(t) : sequentialColor(t);
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

    const { nAP, nML, colorScale, hoveredId, selectedIds, minValue, maxValue } = options;
    this.nAP = nAP;
    this.nML = nML;

    // Compute cell dimensions with 1px gap.
    const GAP = 1;
    this.cellW = Math.max(1, (this.width - GAP * (nML + 1)) / nML);
    this.cellH = Math.max(1, (this.height - GAP * (nAP + 1)) / nAP);

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    this.cellMap.clear();
    const selectedSet = new Set(selectedIds);

    for (const cell of cells) {
      const x = GAP + cell.mlIdx * (this.cellW + GAP);
      const y = GAP + cell.apIdx * (this.cellH + GAP);

      this.cellMap.set(cell.id, { apIdx: cell.apIdx, mlIdx: cell.mlIdx });

      // Fill
      ctx.fillStyle = colorFor(cell.value, minValue, maxValue, colorScale);
      ctx.fillRect(x, y, this.cellW, this.cellH);

      // Border for selected
      if (selectedSet.has(cell.id)) {
        ctx.strokeStyle = "var(--accent, #4fc)";
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, this.cellW - 2, this.cellH - 2);
      }

      // Border for hovered
      if (cell.id === hoveredId) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 0.75, y + 0.75, this.cellW - 1.5, this.cellH - 1.5);
      }
    }
  }

  hitTest(x: number, y: number): number | null {
    if (this.nAP === 0 || this.nML === 0) return null;
    const GAP = 1;
    const mlIdx = Math.floor((x - GAP) / (this.cellW + GAP));
    const apIdx = Math.floor((y - GAP) / (this.cellH + GAP));
    if (mlIdx < 0 || mlIdx >= this.nML || apIdx < 0 || apIdx >= this.nAP) return null;

    // Find electrode by (apIdx, mlIdx)
    for (const [id, cell] of this.cellMap) {
      if (cell.apIdx === apIdx && cell.mlIdx === mlIdx) return id;
    }
    return null;
  }

  dispose(): void {
    this.canvas = null;
    this.ctx = null;
    this.cellMap.clear();
  }
}
