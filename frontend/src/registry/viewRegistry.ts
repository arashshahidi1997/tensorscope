import type { ReactElement } from "react";
import { PlaceholderSliceView } from "../components/views/PlaceholderSliceView";
import { PSDSliceView } from "../components/views/PSDSliceView";
import { DepthMapSliceView } from "../components/views/DepthMapSliceView";
import { SpatialMapSliceView } from "../components/views/SpatialMapSliceView";
import { SpectrogramView } from "../components/views/SpectrogramView";
import { TimeseriesSliceView } from "../components/views/TimeseriesSliceView";
import type { SliceViewProps } from "../components/views/viewTypes";
import type { TensorSchema, ViewDescriptor } from "../types";

/**
 * Canonical view descriptors — mirrors `_VIEW_REGISTRY` in server/state.py.
 *
 * `requiredDims` lists every dim that must be present on a tensor for the
 * view to be applicable. `getAvailableViews(schema)` uses these to filter.
 */
export const VIEW_DESCRIPTORS: ViewDescriptor[] = [
  { id: "timeseries",        label: "Timeseries",   requiredDims: ["time"],              priority: 1 },
  { id: "spatial_map",       label: "Spatial Map",  requiredDims: ["AP", "ML"],          priority: 2 },
  { id: "spectrogram",       label: "Spectrogram",  requiredDims: ["time", "freq"],      priority: 3 },
  { id: "psd_average",       label: "PSD Average",  requiredDims: ["freq"],              priority: 4 },
  { id: "navigator",         label: "Navigator",    requiredDims: ["time"],              priority: 5 },
  { id: "propagation_frame", label: "Propagation",  requiredDims: ["time", "AP", "ML"], priority: 6 },
  { id: "psd_spatial",       label: "PSD Spatial",  requiredDims: ["time", "AP", "ML"], priority: 7 },
  { id: "table",             label: "Table",        requiredDims: [],                    priority: 8 },
  { id: "psd_heatmap",      label: "PSD Heatmap",  requiredDims: ["time"],              priority: 10 },
  { id: "psd_curve",        label: "PSD Curve",    requiredDims: ["time"],              priority: 11 },
  { id: "spectrogram_live", label: "Spectrogram",  requiredDims: ["time"],              priority: 3 },
  { id: "hypnogram",        label: "Hypnogram",    requiredDims: [],                    priority: 12 },
  { id: "event_average",    label: "Event Average", requiredDims: ["time"],             priority: 13 },
  // Linear-probe (Neuropixels DV) depth strip. Gated on a per-channel `depth`
  // coord, which `requiredDims` can't express — availability is resolved from
  // the server's `available_views` in getAvailableViews below. The dims here
  // are the minimum so the descriptor never appears for non-(time,channel)
  // tensors via the fallback path. See docs/design/neuropixels-multiprobe.md.
  { id: "depth_map",        label: "Depth Map",    requiredDims: ["time", "channel"],  priority: 2 },
];

/**
 * Return the subset of VIEW_DESCRIPTORS that can render `schema`.
 * Mirrors the server-side `available_views(data)` function.
 */
export function getAvailableViews(schema: TensorSchema): ViewDescriptor[] {
  // When the server has told us exactly which views apply (`available_views`),
  // trust it — it encodes gating that `requiredDims` can't, e.g. `depth_map`
  // depends on a per-channel `depth` coord, not on a dim. Fall back to the
  // dim-subset predicate for schemas without server-provided availability
  // (e.g. synthetic test schemas). See docs/design/neuropixels-multiprobe.md.
  if (schema.available_views && schema.available_views.length > 0) {
    const allowed = new Set(schema.available_views);
    return VIEW_DESCRIPTORS.filter((d) => allowed.has(d.id));
  }
  return VIEW_DESCRIPTORS.filter((d) =>
    d.requiredDims.every((dim) => schema.dims.includes(dim)),
  );
}

/**
 * Ortho-pair configuration for 4D tensors.
 *
 * Given a tensor's dimension names, returns the pair of view types that
 * form a linked orthogonal slicer (primary 2D heatmap + spatial cross-section).
 * Returns null if the tensor doesn't have the required 4 dims.
 */
export type OrthoPair = {
  primary: string;    // e.g. "spectrogram" (time × freq)
  orthogonal: string; // e.g. "spatial_map" (AP × ML)
};

export function getOrthoPair(dims: string[]): OrthoPair | null {
  const has = (d: string) => dims.includes(d);
  if (has("time") && has("freq") && has("AP") && has("ML")) {
    return { primary: "spectrogram", orthogonal: "spatial_map" };
  }
  return null;
}

/** Component lookup — maps view_type to its React renderer. */
export const viewRegistry: Record<string, (props: SliceViewProps) => ReactElement | null> = {
  timeseries: TimeseriesSliceView,
  spatial_map: SpatialMapSliceView,
  navigator: TimeseriesSliceView, // navigator uses same uPlot renderer; NavigatorView is used separately
  spectrogram: SpectrogramView,
  spectrogram_live: SpectrogramView,
  psd_average: PSDSliceView,
  psd_spatial: PlaceholderSliceView,   // PSD panel views rendered directly in WorkspaceMain
  psd_heatmap: PlaceholderSliceView,  // PSD panel views rendered directly in WorkspaceMain
  psd_curve: PlaceholderSliceView,    // PSD panel views rendered directly in WorkspaceMain
  propagation_frame: SpatialMapSliceView,
  depth_map: DepthMapSliceView,
  table: PlaceholderSliceView,
  event_average: PlaceholderSliceView,  // rendered directly in WorkspaceMain
};
