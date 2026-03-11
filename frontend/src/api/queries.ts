import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type { CoordSummary, ProcessingParamsDTO, SelectionDTO, TensorSliceRequestDTO } from "./types";

export function useStateQuery() {
  return useQuery({
    queryKey: ["state"],
    queryFn: api.getState,
  });
}

export function useTensorQuery(name: string | null) {
  return useQuery({
    queryKey: ["tensor", name],
    queryFn: () => api.getTensor(name!),
    enabled: Boolean(name),
  });
}

export function useSliceQuery(name: string | null, request: TensorSliceRequestDTO | null) {
  return useQuery({
    queryKey: ["slice", name, request],
    queryFn: () => api.getTensorSlice(name!, request!),
    enabled: Boolean(name && request),
    placeholderData: keepPreviousData,
  });
}

export function useEventWindowQuery(
  name: string | null,
  selection: SelectionDTO | null,
  halfWindow = 1,
) {
  return useQuery({
    queryKey: ["events-window", name, selection, halfWindow],
    queryFn: () => {
      const params = new URLSearchParams({
        t0: String(Math.max(0, (selection?.time ?? 0) - halfWindow)),
        t1: String((selection?.time ?? 0) + halfWindow),
      });
      if ((selection?.ap ?? null) !== null) params.set("ap", String(selection?.ap ?? 0));
      if ((selection?.ml ?? null) !== null) params.set("ml", String(selection?.ml ?? 0));
      return api.getEventWindow(name!, params);
    },
    enabled: Boolean(name && selection),
  });
}

export function useProcessingQuery() {
  return useQuery({
    queryKey: ["processing"],
    queryFn: api.getProcessing,
  });
}

export function useSetProcessing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: ProcessingParamsDTO) => api.setProcessing(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["processing"] });
      queryClient.invalidateQueries({ queryKey: ["slice"] });
    },
  });
}

/**
 * Clamp a time window to known data bounds.
 *
 * Prevents sending out-of-range slice requests that would return 0 samples
 * and cause a 400 ("slice request returned no data") from the server.
 * Falls back to the original window if timeCoord bounds are not available.
 */
export function clampWindow(
  window: [number, number],
  timeCoord: CoordSummary | undefined,
): [number, number] {
  const lo = typeof timeCoord?.min === "number" ? timeCoord.min : -Infinity;
  const hi = typeof timeCoord?.max === "number" ? timeCoord.max : Infinity;
  const clo = Math.max(window[0], lo);
  const chi = Math.min(window[1], hi);
  // If the window is entirely outside the data range, fall back to data bounds.
  return clo < chi ? [clo, chi] : [lo === -Infinity ? window[0] : lo, hi === Infinity ? window[1] : hi];
}

/** Build a slice request for a given view type. Returns null if the view cannot be served. */
export function makeDefaultSliceRequest(
  viewType: string,
  selection: SelectionDTO,
  timeWindow: [number, number] = [Math.max(0, selection.time - 1), selection.time + 1],
): TensorSliceRequestDTO {
  switch (viewType) {
    case "spatial_map":
    case "psd_spatial":
      return {
        view_type: viewType,
        selection,
        time_range: [Math.max(0, selection.time - 0.25), selection.time + 0.25],
        max_points: 400,
        downsample: "none",
      };

    case "psd_average":
      // psd_average on a pre-computed freq-only tensor needs no time_range.
      // The server also accepts time_range when the tensor has a time dim.
      return {
        view_type: viewType,
        selection,
      };

    case "navigator": {
      // Navigator always fetches the full recording at low resolution.
      return {
        view_type: viewType,
        selection,
        time_range: timeWindow,
        max_points: 300,
        downsample: "minmax",
      };
    }

    case "spectrogram":
      return {
        view_type: viewType,
        selection,
        time_range: timeWindow,
        max_points: 200,
        downsample: "minmax",
      };

    default: // timeseries, and anything else time-based
      return {
        view_type: viewType,
        selection,
        time_range: timeWindow,
        max_points: 600,
        downsample: "minmax",
      };
  }
}

/** Full-range navigator slice. Uses the tensor's time coord bounds if available. */
export function makeNavigatorRequest(
  selection: SelectionDTO,
  timeCoord: CoordSummary | undefined,
): TensorSliceRequestDTO {
  const t0 = typeof timeCoord?.min === "number" ? timeCoord.min : 0;
  const t1 = typeof timeCoord?.max === "number" ? timeCoord.max : selection.time + 10;
  return {
    view_type: "navigator",
    selection,
    time_range: [t0, t1],
    max_points: 300,
    downsample: "minmax",
  };
}
