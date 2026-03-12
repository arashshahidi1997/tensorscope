/**
 * Transform registry and derived tensor types.
 *
 * These mirror the backend DTOs in tensorscope.server.models
 * and provide the frontend contract for transform operations.
 */

/** Specification for a single transform parameter. */
export type TransformParamSpec = {
  dtype: string;
  default: unknown;
  description: string;
  min_value: number | null;
  max_value: number | null;
  choices: string[] | null;
};

/** Public view of a registered transform. */
export type TransformDefinitionDTO = {
  name: string;
  description: string;
  required_dims: string[];
  param_schema: Record<string, TransformParamSpec>;
  output_dims: string[];
  output_dtype: string | null;
};

/** Request to execute a transform. */
export type TransformRequestDTO = {
  transform_name: string;
  input_names: string[];
  params?: Record<string, unknown>;
  tensor_id?: string;
};

/** Provenance metadata for a derived tensor. */
export type TransformProvenance = {
  transform_name: string;
  params: Record<string, unknown>;
  parent_ids: string[];
};

/** Metadata view of a derived tensor. */
export type DerivedTensorDTO = {
  id: string;
  provenance: TransformProvenance;
  dims: string[];
  shape: number[];
  dtype: string;
  status: "pending" | "computed" | "materialized" | "error";
  cache_key: string | null;
  error: string | null;
};
