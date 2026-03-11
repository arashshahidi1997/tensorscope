import type { ReactElement } from "react";
import { PlaceholderSliceView } from "../components/views/PlaceholderSliceView";
import { PSDSliceView } from "../components/views/PSDSliceView";
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
  { id: "timeseries",  label: "Timeseries",  requiredDims: ["time"] },
  { id: "navigator",   label: "Navigator",   requiredDims: ["time"] },
  { id: "spatial_map", label: "Spatial Map", requiredDims: ["AP", "ML"] },
  { id: "spectrogram", label: "Spectrogram", requiredDims: ["time", "freq"] },
  { id: "psd_average", label: "PSD Average", requiredDims: ["freq"] },
  { id: "psd_spatial", label: "PSD Spatial", requiredDims: ["freq", "AP", "ML"] },
  { id: "table",       label: "Table",       requiredDims: [] },
];

/**
 * Return the subset of VIEW_DESCRIPTORS that can render `schema`.
 * Mirrors the server-side `available_views(data)` function.
 */
export function getAvailableViews(schema: TensorSchema): ViewDescriptor[] {
  return VIEW_DESCRIPTORS.filter((d) =>
    d.requiredDims.every((dim) => schema.dims.includes(dim)),
  );
}

/** Component lookup — maps view_type to its React renderer. */
export const viewRegistry: Record<string, (props: SliceViewProps) => ReactElement | null> = {
  timeseries: TimeseriesSliceView,
  spatial_map: SpatialMapSliceView,
  navigator: TimeseriesSliceView, // navigator uses same uPlot renderer; NavigatorView is used separately
  spectrogram: SpectrogramView,
  psd_average: PSDSliceView,
  psd_spatial: SpatialMapSliceView,
  table: PlaceholderSliceView,
};
