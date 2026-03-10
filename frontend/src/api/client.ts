import type {
  EventRecordDTO,
  EventStreamMetaDTO,
  LayoutDTO,
  LayoutUpdateDTO,
  SelectionDTO,
  StateDTO,
  TensorMetaDTO,
  TensorSliceDTO,
  TensorSliceRequestDTO,
  TensorSummaryDTO,
} from "./types";

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export const api = {
  getState(): Promise<StateDTO> {
    return request<StateDTO>("/api/v1/state");
  },

  listTensors(): Promise<TensorSummaryDTO[]> {
    return request<TensorSummaryDTO[]>("/api/v1/tensors");
  },

  getTensor(name: string): Promise<TensorMetaDTO> {
    return request<TensorMetaDTO>(`/api/v1/tensors/${name}`);
  },

  getTensorSlice(name: string, body: TensorSliceRequestDTO): Promise<TensorSliceDTO> {
    return request<TensorSliceDTO>(`/api/v1/tensors/${name}/slice`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  getSelection(): Promise<SelectionDTO> {
    return request<SelectionDTO>("/api/v1/selection");
  },

  updateSelection(body: SelectionDTO): Promise<SelectionDTO> {
    return request<SelectionDTO>("/api/v1/selection", {
      method: "PUT",
      body: JSON.stringify(body),
    });
  },

  getLayout(): Promise<LayoutDTO> {
    return request<LayoutDTO>("/api/v1/layout");
  },

  updateLayout(body: LayoutUpdateDTO): Promise<LayoutDTO> {
    return request<LayoutDTO>("/api/v1/layout", {
      method: "PUT",
      body: JSON.stringify(body),
    });
  },

  listEvents(): Promise<EventStreamMetaDTO[]> {
    return request<EventStreamMetaDTO[]>("/api/v1/events");
  },

  getEventWindow(name: string, params: URLSearchParams): Promise<EventRecordDTO[]> {
    return request<EventRecordDTO[]>(`/api/v1/events/${name}/window?${params.toString()}`);
  },
};
