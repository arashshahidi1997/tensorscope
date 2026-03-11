import type { ReactElement } from "react";
import { PlaceholderSliceView } from "../components/views/PlaceholderSliceView";
import { PSDSliceView } from "../components/views/PSDSliceView";
import { SpatialMapSliceView } from "../components/views/SpatialMapSliceView";
import { SpectrogramView } from "../components/views/SpectrogramView";
import { TimeseriesSliceView } from "../components/views/TimeseriesSliceView";
import type { SliceViewProps } from "../components/views/viewTypes";

export const viewRegistry: Record<string, (props: SliceViewProps) => ReactElement | null> = {
  timeseries: TimeseriesSliceView,
  spatial_map: SpatialMapSliceView,
  navigator: TimeseriesSliceView, // navigator uses same uPlot renderer; NavigatorView is used separately
  spectrogram: SpectrogramView,
  psd_average: PSDSliceView,
  psd_spatial: SpatialMapSliceView,
  table: PlaceholderSliceView,
};
