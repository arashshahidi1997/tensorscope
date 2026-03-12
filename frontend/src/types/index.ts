/**
 * Single stable import path for TensorScope domain types.
 *
 * Usage:
 *   import type { SelectionState, TimeWindow } from "../types";
 *   import type { TensorSchema, TensorMetaDTO } from "../types";
 *   import type { ViewDescriptor } from "../types";
 */

export type {
  TimeWindow,
  TimeCursor,
  SpatialSelection,
  FreqSelection,
  EventSelection,
  SelectionState,
  SelectionPatch,
} from "./selection";

export type {
  CoordSummary,
  TensorSummaryDTO,
  TensorMetaDTO,
  TensorSchema,
} from "./tensor";

export type { ViewDescriptor } from "./view";

export type { ElectrodeLayout, ElectrodeCoord } from "./spatialLayout";
export { buildElectrodeLayout } from "./spatialLayout";

export type {
  TransformParamSpec,
  TransformDefinitionDTO,
  TransformRequestDTO,
  TransformProvenance,
  DerivedTensorDTO,
} from "./transform";

export type {
  DAGTensorNodeDTO,
  DAGTransformNodeDTO,
  TransformEdgeDTO,
  ProvenanceStepDTO,
  WorkspaceDAGDTO,
  DAGNodeVisibilityDTO,
} from "./dag";

export type {
  PipelineSourceTensor,
  PipelineTransformNode,
  PipelineDerivedTensor,
  ExecutionMetadata,
  PipelineSpec,
  PipelineExportRequest,
  WorkflowArtifact,
  PipelineExportResponse,
} from "./pipeline";
