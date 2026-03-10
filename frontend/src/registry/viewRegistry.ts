import { PlaceholderSliceView } from "../components/views/PlaceholderSliceView";

export const viewRegistry: Record<string, typeof PlaceholderSliceView> = {
  timeseries: PlaceholderSliceView,
  spatial_map: PlaceholderSliceView,
  navigator: PlaceholderSliceView,
  spectrogram: PlaceholderSliceView,
  psd_average: PlaceholderSliceView,
  psd_spatial: PlaceholderSliceView,
  table: PlaceholderSliceView,
};
