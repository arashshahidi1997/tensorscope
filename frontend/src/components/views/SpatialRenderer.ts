/**
 * Renderer abstraction for spatial electrode views. M3 addition.
 *
 * The Canvas implementation (ChannelGridRenderer) is the required CPU path.
 * A WebGL/deck.gl implementation is a future optional accelerated path.
 * Both must implement this interface so SpatialMapSliceView is backend-agnostic.
 */

export type SpatialCellWithId = {
  /** Electrode identifier (corresponds to ElectrodeCoord.id). */
  id: number;
  /** AP rank index (0-based integer). */
  apIdx: number;
  /** ML rank index (0-based integer). */
  mlIdx: number;
  /** Data value used for color mapping. */
  value: number;
};

export type SpatialRenderOptions = {
  /** Number of distinct AP positions (rows). */
  nAP: number;
  /** Number of distinct ML positions (columns). */
  nML: number;
  /** "sequential" for power/amplitude maps; "cyclical" for phase maps. */
  colorScale: "sequential" | "cyclical";
  /** Currently hovered electrode id, or null. */
  hoveredId: number | null;
  /** Currently selected electrode ids (multi-select). */
  selectedIds: number[];
  /** Min data value (for color normalization). */
  minValue: number;
  /** Max data value (for color normalization). */
  maxValue: number;
  /**
   * Optional set of masked electrode ids — painted with a distinct hatched
   * style (not value-colored, not transparent) so the user can see the mask
   * footprint on top of the data.
   */
  maskedIds?: Set<number>;
  /**
   * Audit A2: matplotlib-style colormap. "jet" (the user's request) renders
   * the classic blue→cyan→green→yellow→red ramp; "viridis"/"inferno"/
   * "cividis" are perceptually-uniform alternatives. Falls back to the
   * legacy HSL ramp when unset for back-compat with views still on the old
   * "sequential" path.
   */
  colormap?: "jet" | "viridis" | "inferno" | "cividis" | "sequential";
  /**
   * Audit A2: when true, use bilinear smoothing on the canvas blit so
   * neighbouring channels blend continuously. When false (default), upscale
   * nearest-neighbor — gives matplotlib `imshow`'s default crisp-tile look
   * with no visible 1-pixel gaps between cells.
   */
  smoothing?: boolean;
  /**
   * Editor mode: draw a thin 1px stroke around every cell so they're
   * visually distinct even when all values are identical (e.g. the empty
   * mask editor where every cell is 0). Off by default — data views render
   * gap-free per matplotlib `imshow` look.
   */
  showCellBorders?: boolean;
  /**
   * G7: per-cell region annotation. Keyed by flat id (apIdx * nML + mlIdx).
   * When present, the renderer draws a small region-coloured corner tab on
   * each annotated cell. Cells without an entry render unchanged.
   */
  regionByFlatId?: Map<number, string>;
  /** Region → swatch color, paired with `regionByFlatId`. */
  regionPalette?: Map<string, string>;
};

export interface SpatialRendererBackend {
  /**
   * (Re)initialize renderer to the given canvas and pixel dimensions.
   * Called once on mount and again whenever the container is resized.
   */
  init(canvas: HTMLCanvasElement, width: number, height: number): void;

  /**
   * Render one frame of electrode data.
   * Called whenever cells or options change.
   */
  render(cells: SpatialCellWithId[], options: SpatialRenderOptions): void;

  /**
   * Hit-test a pointer position (canvas-relative pixels).
   * Returns the electrode id under the pointer, or null.
   */
  hitTest(x: number, y: number): number | null;

  /**
   * Release any held resources (GPU buffers, etc.).
   * Called on component unmount.
   */
  dispose(): void;
}
