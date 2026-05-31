/**
 * Stable domain types for tensor metadata.
 *
 * Wire DTOs live in ../api/types. This module re-exports the stable subset
 * under domain names and adds lean types that are not part of the wire format.
 */

export type {
  CoordSummary,
  TensorSummaryDTO,
  TensorMetaDTO,
} from "../api/types";

/**
 * Lean tensor schema — dims, shape, dtype only.
 *
 * Used when views or registries need to test compatibility without carrying
 * the full server metadata bag.
 */
export type TensorSchema = {
  dims: string[];
  shape: number[];
  dtype: string;
  /**
   * Optional server-computed list of applicable view ids (`available_views`
   * from TensorMetaDTO). When present, `getAvailableViews` trusts it over the
   * dim-subset predicate — it encodes gating that dims alone can't express
   * (e.g. `depth_map` depends on a per-channel `depth` coord, not a dim).
   * See docs/design/neuropixels-multiprobe.md.
   */
  available_views?: string[];
};
