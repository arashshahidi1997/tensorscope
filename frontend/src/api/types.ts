export type DownsampleMethod = "none" | "minmax" | "lttb";

export type CoordSummary = {
  name: string;
  dtype: string;
  length: number;
  min: string | number | null;
  max: string | number | null;
  values?: Array<string | number> | null;
};

export type SelectionDTO = {
  time: number;
  freq: number;
  ap: number;
  ml: number;
  channel: number | null;
};

export type LayoutDTO = {
  title: string;
  theme: string;
  current_preset: string;
  grid_assignments: Record<string, [number, number, number, number]>;
  sidebar_panels: string[];
  available_presets: string[];
};

export type LayoutUpdateDTO = {
  preset: string;
};

export type TensorSummaryDTO = {
  name: string;
  dims: string[];
  shape: number[];
  dtype: string;
  transform: string;
  source: string | null;
};

export type TensorMetaDTO = TensorSummaryDTO & {
  available_views: string[];
  coords: CoordSummary[];
};

export type EventStreamMetaDTO = {
  name: string;
  time_col: string;
  id_col: string;
  n_events: number;
  time_range: [number | null, number | null];
  columns: string[];
};

export type EventRecordDTO = {
  record: Record<string, unknown>;
};

export type StateDTO = {
  session_id: string;
  active_tensor: string;
  selection: SelectionDTO;
  layout: LayoutDTO;
  tensors: TensorSummaryDTO[];
  events: EventStreamMetaDTO[];
};

export type PSDParamsDTO = {
  NW?: number;
  fmax?: number;
};

export type TensorSliceRequestDTO = {
  view_type: string;
  selection: SelectionDTO;
  time_range?: [number, number];
  freq_range?: [number, number];
  channels?: number[];
  ap_range?: [number, number];
  ml_range?: [number, number];
  /** Required for view_type "propagation_frame". Selects the nearest time frame. */
  frame_time?: number;
  max_points?: number;
  downsample?: DownsampleMethod;
  /** PSD computation parameters (for psd_live view_type). */
  psd_params?: PSDParamsDTO;
};

export type TensorSliceDTO = {
  name: string;
  view_type: string;
  dims: string[];
  shape: number[];
  encoding: "arrow_ipc";
  payload: string;
  meta: {
    coords?: CoordSummary[];
    axis_labels?: string[];
    units?: string | null;
    selected_time?: string | number | null;
    downsampling?: {
      method: DownsampleMethod;
      max_points: number | null;
      original_shape: number[];
      returned_shape: number[];
    };
  };
};

export type ProcessingParamsDTO = {
  cmr: boolean;
  bandpass_lo: number | null;
  bandpass_hi: number | null;
  bandpass_order: number;
  notch_freq: number | null;
  notch_harmonics: number;
  notch_freqs_list: number[] | null;
  notch_q: number;
  spatial_median: boolean;
  spatial_median_size: number;
  zscore: boolean;
  zscore_robust: boolean;
};

export type BrainstateMetaDTO = {
  available: boolean;
  state_names: string[];
  time_range: [number | null, number | null];
  n_steps: number;
};

export type BrainstateIntervalDTO = {
  start: number;
  end: number;
  state: string;
};

export type ApiErrorDTO = {
  code: string;
  message: string;
  details?: Record<string, unknown> | null;
};
