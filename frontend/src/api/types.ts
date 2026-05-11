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
  fmin?: number;
  fmax?: number;
};

/** Multitaper-spectrogram parameters for the `spectrogram_live` view. */
export type SpectrogramLiveParamsDTO = {
  bandwidth_hz?: number;
  nperseg_s?: number;
  noverlap_pct?: number;
  fmin_hz?: number;
  fmax_hz?: number;
  /** Per-freq median baseline subtraction (Prerau-style). Default true. */
  normalize_per_freq_median?: boolean;
  /**
   * Cap on the number of time segments returned. Server widens the hop
   * (reduces effective noverlap) to honor the cap. Pass `null` to disable.
   * Default 200.
   */
  max_time_segments?: number | null;
};

/**
 * Per-request bandpass filter — applied to the SLICED data via a 4th-order
 * Butterworth zero-phase filter inside the server's `_prepare_slice`. Used
 * by the timeseries view's band-overlay UI; see
 * `docs/design/filtered-band-overlay.md`.
 */
export type BandpassParamsDTO = {
  lo_hz: number;
  hi_hz: number;
  order?: number;
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
  /** Number of frames to return for view_type "propagation_movie". Defaults to ~window_s × 30, capped at 240. */
  n_frames?: number;
  max_points?: number;
  downsample?: DownsampleMethod;
  /** PSD computation parameters (for psd_live view_type). */
  psd_params?: PSDParamsDTO;
  /** Multitaper-spectrogram parameters (for spectrogram_live view_type). */
  spectrogram_live_params?: SpectrogramLiveParamsDTO;
  /** Optional per-request bandpass — fills the band-overlay feature. */
  bandpass?: BandpassParamsDTO;
};

export type MaskStateDTO = {
  tensor: string;
  masked_ids: number[];
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
    /** Audit F3: server-applied display-only transforms (e.g. zscore_offset). */
    display_transforms?: string[];
    /** Audit F21: per-slice processing status. */
    processing?: {
      requested: boolean;
      applied: boolean;
      error: string | null;
    };
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

export type DetectorParamSpecDTO = {
  dtype: string;
  default: unknown;
  description: string;
  required: boolean;
  min_value: number | null;
  max_value: number | null;
  choices: string[] | null;
};

export type DetectorDefinitionDTO = {
  name: string;
  description: string;
  param_schema: Record<string, DetectorParamSpecDTO>;
};

export type DetectRequestDTO = {
  detector_name: string;
  tensor_name: string;
  params: Record<string, unknown>;
  stream_name?: string;
};

export type DetectResultDTO = {
  stream_name: string;
  n_events: number;
  detector_name: string;
};

export type ApiErrorDTO = {
  code: string;
  message: string;
  details?: Record<string, unknown> | null;
};
