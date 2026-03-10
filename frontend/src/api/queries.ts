import { useQuery } from "@tanstack/react-query";
import { api } from "./client";
import type { SelectionDTO, TensorSliceRequestDTO } from "./types";

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
  });
}

export function makeDefaultSliceRequest(
  viewType: string,
  selection: SelectionDTO,
): TensorSliceRequestDTO {
  return {
    view_type: viewType,
    selection,
    time_range: [Math.max(0, selection.time - 1), selection.time + 1],
    max_points: 400,
    downsample: "minmax",
  };
}
