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
