import type {
  BrainstateIntervalDTO,
  BrainstateMetaDTO,
  EventRecordDTO,
  EventStreamMetaDTO,
  LayoutDTO,
  LayoutUpdateDTO,
  ProcessingParamsDTO,
  SelectionDTO,
  StateDTO,
  TensorMetaDTO,
  TensorSliceDTO,
  TensorSliceRequestDTO,
  TensorSummaryDTO,
} from "./types";
import type {
  TransformDefinitionDTO,
  TransformRequestDTO,
  DerivedTensorDTO,
} from "../types/transform";
import type {
  DAGTensorNodeDTO,
  DAGTransformNodeDTO,
  DAGNodeVisibilityDTO,
  ProvenanceStepDTO,
  WorkspaceDAGDTO,
} from "../types/dag";
import type {
  PipelineExportRequest,
  PipelineExportResponse,
} from "../types/pipeline";

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

  getProcessing(): Promise<ProcessingParamsDTO> {
    return request<ProcessingParamsDTO>("/api/v1/processing");
  },

  setProcessing(body: ProcessingParamsDTO): Promise<ProcessingParamsDTO> {
    return request<ProcessingParamsDTO>("/api/v1/processing", {
      method: "PUT",
      body: JSON.stringify(body),
    });
  },

  listTransforms(): Promise<TransformDefinitionDTO[]> {
    return request<TransformDefinitionDTO[]>("/api/v1/transforms");
  },

  getTransform(name: string): Promise<TransformDefinitionDTO> {
    return request<TransformDefinitionDTO>(`/api/v1/transforms/${name}`);
  },

  listCompatibleTransforms(tensorName: string): Promise<TransformDefinitionDTO[]> {
    return request<TransformDefinitionDTO[]>(`/api/v1/transforms/compatible/${tensorName}`);
  },

  executeTransform(body: TransformRequestDTO): Promise<DerivedTensorDTO> {
    return request<DerivedTensorDTO>("/api/v1/transforms/execute", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  getDAG(): Promise<WorkspaceDAGDTO> {
    return request<WorkspaceDAGDTO>("/api/v1/dag");
  },

  getDAGTensorNode(nodeId: string): Promise<DAGTensorNodeDTO> {
    return request<DAGTensorNodeDTO>(`/api/v1/dag/tensors/${nodeId}`);
  },

  getDAGTransformNode(nodeId: string): Promise<DAGTransformNodeDTO> {
    return request<DAGTransformNodeDTO>(`/api/v1/dag/transforms/${nodeId}`);
  },

  updateDAGTensorVisibility(
    nodeId: string,
    body: DAGNodeVisibilityDTO,
  ): Promise<DAGTensorNodeDTO> {
    return request<DAGTensorNodeDTO>(`/api/v1/dag/tensors/${nodeId}/visibility`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  },

  getDAGUpstream(nodeId: string): Promise<DAGTransformNodeDTO[]> {
    return request<DAGTransformNodeDTO[]>(`/api/v1/dag/upstream/${nodeId}`);
  },

  getDAGDownstream(nodeId: string): Promise<unknown[]> {
    return request<unknown[]>(`/api/v1/dag/downstream/${nodeId}`);
  },

  getDAGProvenance(tensorNodeId: string): Promise<ProvenanceStepDTO[]> {
    return request<ProvenanceStepDTO[]>(`/api/v1/dag/provenance/${tensorNodeId}`);
  },

  // Brainstates API
  getBrainstateMeta(): Promise<BrainstateMetaDTO> {
    return request<BrainstateMetaDTO>("/api/v1/brainstates");
  },

  getBrainstateIntervals(t0?: number, t1?: number): Promise<BrainstateIntervalDTO[]> {
    const params = new URLSearchParams();
    if (t0 != null) params.set("t0", String(t0));
    if (t1 != null) params.set("t1", String(t1));
    const qs = params.toString();
    return request<BrainstateIntervalDTO[]>(`/api/v1/brainstates/intervals${qs ? `?${qs}` : ""}`);
  },

  // Pipeline API (M6)
  exportPipeline(body: PipelineExportRequest): Promise<PipelineExportResponse> {
    return request<PipelineExportResponse>("/api/v1/pipeline/export", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  promoteTensor(tensorNodeId: string): Promise<{ status: string; tensor_node_id: string }> {
    return request<{ status: string; tensor_node_id: string }>(
      `/api/v1/pipeline/promote/${encodeURIComponent(tensorNodeId)}`,
      { method: "POST" },
    );
  },

  demoteTensor(tensorNodeId: string): Promise<{ status: string; tensor_node_id: string }> {
    return request<{ status: string; tensor_node_id: string }>(
      `/api/v1/pipeline/demote/${encodeURIComponent(tensorNodeId)}`,
      { method: "POST" },
    );
  },
};
