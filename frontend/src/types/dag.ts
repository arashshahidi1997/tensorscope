/**
 * Workspace DAG types for transform lineage inspection.
 *
 * These mirror the backend DTOs in tensorscope.server.models
 * and provide the frontend contract for DAG operations.
 */

/** Tensor node in the workspace DAG. */
export type DAGTensorNodeDTO = {
  id: string;
  tensor_id: string;
  node_type: "source" | "derived";
  visible: boolean;
  exploratory: boolean;
  display_name: string;
  pipeline_selected: boolean;
};

/** Transform node in the workspace DAG. */
export type DAGTransformNodeDTO = {
  id: string;
  transform_name: string;
  params: Record<string, unknown>;
  status: "pending" | "computed" | "error";
  error: string | null;
};

/** Directed edge in the workspace DAG. */
export type TransformEdgeDTO = {
  source_id: string;
  target_id: string;
  edge_type: "input" | "output";
};

/** One step in a provenance chain. */
export type ProvenanceStepDTO = {
  input_tensor_id: string;
  transform_name: string;
  params: Record<string, unknown>;
  output_tensor_id: string;
};

/** Full workspace DAG serialization. */
export type WorkspaceDAGDTO = {
  tensor_nodes: DAGTensorNodeDTO[];
  transform_nodes: DAGTransformNodeDTO[];
  edges: TransformEdgeDTO[];
};

/** Request to update tensor node visibility/exploratory state. */
export type DAGNodeVisibilityDTO = {
  visible?: boolean;
  exploratory?: boolean;
};
