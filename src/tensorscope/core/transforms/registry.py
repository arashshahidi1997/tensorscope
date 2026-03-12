"""Transform registry: declarative transform definitions with input/output specs."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

import xarray as xr

from tensorscope.core.state import TensorNode


@dataclass(frozen=True, slots=True)
class ParamSpec:
    """Specification for a single transform parameter.

    Parameters
    ----------
    dtype
        Expected type name: "float", "int", "str", "bool", or "list[float]" etc.
    default
        Default value (None = required parameter).
    description
        Human-readable description.
    min_value / max_value
        Optional numeric bounds.
    choices
        Optional enum-like choices.
    """

    dtype: str
    default: Any = None
    description: str = ""
    min_value: float | None = None
    max_value: float | None = None
    choices: tuple[str, ...] | None = None

    def validate(self, value: Any) -> Any:
        """Basic validation; returns coerced value or raises ValueError."""
        if value is None:
            if self.default is not None:
                return self.default
            raise ValueError(f"required parameter not provided")
        if self.min_value is not None and isinstance(value, (int, float)):
            if value < self.min_value:
                raise ValueError(f"value {value} below minimum {self.min_value}")
        if self.max_value is not None and isinstance(value, (int, float)):
            if value > self.max_value:
                raise ValueError(f"value {value} above maximum {self.max_value}")
        if self.choices is not None and value not in self.choices:
            raise ValueError(f"value {value!r} not in {self.choices}")
        return value


@dataclass(frozen=True, slots=True)
class InputSpec:
    """Declares what input tensors a transform requires.

    Parameters
    ----------
    required_dims
        Dimension names that must be present in each input tensor.
    min_inputs / max_inputs
        How many input tensors the transform accepts.
    """

    required_dims: tuple[str, ...] = ()
    min_inputs: int = 1
    max_inputs: int = 1

    def is_compatible(self, node: TensorNode) -> bool:
        """Check if a tensor satisfies this input spec."""
        tensor_dims = set(node.dims)
        return all(d in tensor_dims for d in self.required_dims)


@dataclass(frozen=True, slots=True)
class OutputSpec:
    """Declares the output tensor schema of a transform.

    Parameters
    ----------
    dims
        Output dimension names.
    dtype
        Output dtype (None = inherit from input).
    coord_rules
        How output coords relate to input coords.
    """

    dims: tuple[str, ...] = ()
    dtype: str | None = None
    coord_rules: dict[str, str] = field(default_factory=dict)


# Compute function signature: (inputs, params) -> DataArray
ComputeFn = Callable[[list[xr.DataArray], dict[str, Any]], xr.DataArray]


@dataclass(frozen=True, slots=True)
class TransformDefinition:
    """A registered transform: name + specs + compute function.

    Parameters
    ----------
    name
        Unique registry key (e.g., "bandpass", "spectrogram").
    input_spec
        Requirements for input tensors.
    param_schema
        Parameter name → ParamSpec mapping.
    output_spec
        Output tensor schema declaration.
    compute
        Function that executes the transform.
    description
        Human-readable description.
    """

    name: str
    input_spec: InputSpec
    param_schema: dict[str, ParamSpec] = field(default_factory=dict)
    output_spec: OutputSpec = field(default_factory=OutputSpec)
    compute: ComputeFn = field(default=lambda inputs, params: inputs[0])
    description: str = ""

    def validate_params(self, params: dict[str, Any]) -> dict[str, Any]:
        """Validate and fill defaults for transform parameters."""
        validated: dict[str, Any] = {}
        for name, spec in self.param_schema.items():
            validated[name] = spec.validate(params.get(name))
        return validated


class TransformRegistry:
    """Registry of available transforms.

    Transforms are registered by name and can be queried for compatibility
    with specific tensors.
    """

    def __init__(self) -> None:
        self._transforms: dict[str, TransformDefinition] = {}

    def register(self, defn: TransformDefinition) -> None:
        """Register a transform definition. Raises if name already taken."""
        if defn.name in self._transforms:
            raise ValueError(f"Transform {defn.name!r} already registered")
        self._transforms[defn.name] = defn

    def get(self, name: str) -> TransformDefinition:
        """Look up a transform by name. Raises KeyError if not found."""
        if name not in self._transforms:
            raise KeyError(f"Transform {name!r} not found in registry")
        return self._transforms[name]

    def list(self) -> list[str]:
        """Return all registered transform names."""
        return list(self._transforms.keys())

    def list_definitions(self) -> list[TransformDefinition]:
        """Return all registered transform definitions."""
        return list(self._transforms.values())

    def list_compatible(self, node: TensorNode) -> list[TransformDefinition]:
        """Return transforms compatible with the given tensor's dimensions."""
        return [
            defn
            for defn in self._transforms.values()
            if defn.input_spec.is_compatible(node)
        ]

    def unregister(self, name: str) -> None:
        """Remove a transform from the registry."""
        if name not in self._transforms:
            raise KeyError(f"Transform {name!r} not found in registry")
        del self._transforms[name]

    def __contains__(self, name: str) -> bool:
        return name in self._transforms

    def __len__(self) -> int:
        return len(self._transforms)
