"""Transform executor: validates, executes, and caches derived tensors."""

from __future__ import annotations

import logging
import uuid
from typing import Any

import xarray as xr

from tensorscope.core.state import TensorNode, TensorRegistry
from tensorscope.core.transforms.cache import TransformCache
from tensorscope.core.transforms.model import DerivedTensor, TransformProvenance
from tensorscope.core.transforms.registry import TransformRegistry

logger = logging.getLogger(__name__)


class TransformExecutor:
    """Executes transforms, producing derived tensors with provenance.

    Synchronous execution for M4.  Worker dispatch deferred to M5+.
    """

    def __init__(
        self,
        transform_registry: TransformRegistry,
        tensor_registry: TensorRegistry,
        cache: TransformCache | None = None,
    ) -> None:
        self._transforms = transform_registry
        self._tensors = tensor_registry
        self._cache = cache or TransformCache()

    @property
    def cache(self) -> TransformCache:
        return self._cache

    def execute(
        self,
        transform_name: str,
        input_names: list[str],
        params: dict[str, Any] | None = None,
        *,
        tensor_id: str | None = None,
    ) -> DerivedTensor:
        """Execute a transform and return a DerivedTensor.

        Parameters
        ----------
        transform_name
            Registry key of the transform to apply.
        input_names
            Names of input tensors in the tensor registry.
        params
            Transform parameters (validated against param_schema).
        tensor_id
            Optional explicit id for the derived tensor.
            Auto-generated if not provided.

        Returns
        -------
        DerivedTensor
            The computed derived tensor, registered in the tensor registry.

        Raises
        ------
        KeyError
            If the transform or input tensor is not found.
        ValueError
            If inputs are incompatible or parameters are invalid.
        """
        params = params or {}

        # 1. Look up transform definition.
        defn = self._transforms.get(transform_name)

        # 2. Resolve input tensors.
        inputs: list[TensorNode] = []
        for name in input_names:
            inputs.append(self._tensors.get(name))

        # 3. Validate input count.
        if len(inputs) < defn.input_spec.min_inputs:
            raise ValueError(
                f"Transform {transform_name!r} requires at least "
                f"{defn.input_spec.min_inputs} inputs, got {len(inputs)}"
            )
        if len(inputs) > defn.input_spec.max_inputs:
            raise ValueError(
                f"Transform {transform_name!r} accepts at most "
                f"{defn.input_spec.max_inputs} inputs, got {len(inputs)}"
            )

        # 4. Validate input compatibility.
        for node in inputs:
            if not defn.input_spec.is_compatible(node):
                raise ValueError(
                    f"Tensor {node.name!r} (dims={node.dims}) is not compatible "
                    f"with transform {transform_name!r} "
                    f"(requires {defn.input_spec.required_dims})"
                )

        # 5. Validate and fill parameter defaults.
        validated_params = defn.validate_params(params)

        # 6. Build provenance.
        provenance = TransformProvenance(
            transform_name=transform_name,
            params=validated_params,
            parent_ids=tuple(n.name for n in inputs),
        )

        # 7. Check cache.
        cache_key = provenance.cache_key()
        cached = self._cache.get(cache_key)
        if cached is not None and cached.is_computed:
            logger.debug("Cache hit for %s (key=%s)", transform_name, cache_key)
            return cached

        # 8. Execute compute.
        tid = tensor_id or f"{transform_name}_{uuid.uuid4().hex[:8]}"

        try:
            input_arrays = [node.data for node in inputs]
            result_data = defn.compute(input_arrays, validated_params)
        except Exception as exc:
            derived = DerivedTensor(
                id=tid,
                provenance=provenance,
                dims=defn.output_spec.dims or (),
                shape=(),
                dtype="",
                status="error",
                error=str(exc),
                cache_key=cache_key,
            )
            logger.error("Transform %s failed: %s", transform_name, exc)
            return derived

        # 9. Build DerivedTensor.
        coords_meta: dict[str, Any] = {}
        for dim in result_data.dims:
            if dim in result_data.coords:
                c = result_data.coords[dim].values
                try:
                    min_val = float(c[0]) if len(c) > 0 else None
                    max_val = float(c[-1]) if len(c) > 0 else None
                except (ValueError, TypeError):
                    min_val = str(c[0]) if len(c) > 0 else None
                    max_val = str(c[-1]) if len(c) > 0 else None
                coords_meta[str(dim)] = {
                    "length": len(c),
                    "min": min_val,
                    "max": max_val,
                }

        derived = DerivedTensor(
            id=tid,
            provenance=provenance,
            dims=tuple(str(d) for d in result_data.dims),
            shape=tuple(int(s) for s in result_data.shape),
            dtype=str(result_data.dtype),
            coords=coords_meta,
            status="computed",
            data=result_data,
            cache_key=cache_key,
        )

        # 10. Cache the result.
        self._cache.put(derived)

        # 11. Register as a TensorNode so views can slice it.
        if tid not in self._tensors:
            self._tensors.add(
                TensorNode(
                    name=tid,
                    data=result_data,
                    source=inputs[0].name if inputs else None,
                    transform=transform_name,
                    params=validated_params,
                )
            )

        logger.info(
            "Computed %s → %s (shape=%s, dtype=%s)",
            transform_name, tid, derived.shape, derived.dtype,
        )
        return derived
