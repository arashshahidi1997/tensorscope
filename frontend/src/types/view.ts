/**
 * Minimal view descriptor types for TensorScope M1.
 *
 * This is the planned ViewRegistry contract shape. The current frontend
 * registry (frontend/src/registry/viewRegistry.ts) is a thin lookup table;
 * these types define the target contract for when it is formalised.
 *
 * Planned — not yet wired to the registry or store.
 */

import type { TensorSchema } from "./tensor";

/**
 * Describes a view type that TensorScope knows how to render.
 *
 * - id: matches the view_type string used in TensorSliceRequestDTO
 * - label: human-readable display name
 * - requiredDims: dim names that must be present on the tensor for this view
 *   to be valid (e.g. ["time", "channel"] for timeseries)
 * - canRender: optional predicate for richer compatibility checks beyond dims
 */
export type ViewDescriptor = {
  id: string;
  label: string;
  requiredDims: string[];
  /** Lower number = higher priority for grid placement. */
  priority?: number;
  canRender?: (schema: TensorSchema) => boolean;
};
