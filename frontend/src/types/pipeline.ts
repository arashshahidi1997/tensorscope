/**
 * Pipeline export types for M6.
 *
 * These types represent a curated, reproducible subset of the workspace DAG
 * that can be serialized and optionally cooked into a workflow.
 */

export interface PipelineSourceTensor {
  tensor_id: string;
  data_ref: string;
}

export interface PipelineTransformNode {
  node_id: string;
  transform_name: string;
  params: Record<string, unknown>;
  inputs: string[];
  output: string;
}

export interface PipelineDerivedTensor {
  tensor_id: string;
  dims: string[];
  dtype: string;
}

export interface ExecutionMetadata {
  created_at: string;
  session_id: string;
  description: string;
}

export interface PipelineSpec {
  version: string;
  name: string;
  id: string;
  source_tensors: PipelineSourceTensor[];
  transforms: PipelineTransformNode[];
  derived_tensors: PipelineDerivedTensor[];
  outputs: string[];
  execution_metadata: ExecutionMetadata;
  cooker_profile: string | null;
}

export interface PipelineExportRequest {
  output_tensor_ids: string[];
  name?: string;
  cooker_profile?: string | null;
  description?: string;
}

export interface WorkflowArtifact {
  filename: string;
  content: string;
}

export interface PipelineExportResponse {
  spec: PipelineSpec;
  workflow_artifacts: WorkflowArtifact[];
}
