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
