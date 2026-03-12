"""Derived tensor model with transform provenance."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any, Literal

import xarray as xr


@dataclass(frozen=True, slots=True)
class TransformProvenance:
    """Immutable record of how a derived tensor was produced.

    Parameters
    ----------
    transform_name
        Registry key of the transform that produced this tensor.
    params
        Frozen transform parameters (must be JSON-serializable).
    parent_ids
        Ordered input tensor identifiers.
    """

    transform_name: str
    params: dict[str, Any] = field(default_factory=dict)
    parent_ids: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "transform_name": self.transform_name,
            "params": self.params,
            "parent_ids": list(self.parent_ids),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> TransformProvenance:
        return cls(
            transform_name=data["transform_name"],
            params=data.get("params", {}),
            parent_ids=tuple(data.get("parent_ids", ())),
        )

    def cache_key(self) -> str:
        """Deterministic cache key derived from provenance content."""
        canonical = json.dumps(self.to_dict(), sort_keys=True, default=str)
        return hashlib.sha256(canonical.encode()).hexdigest()[:16]


@dataclass(slots=True)
class DerivedTensor:
    """A tensor produced by applying a registered transform to one or more inputs.

    DerivedTensor is a first-class data object: views treat it identically
    to source tensors.  Provenance is stored explicitly so the full
    computation lineage can be reconstructed.

    Parameters
    ----------
    id
        Unique identifier for this derived tensor.
    provenance
        How this tensor was produced (transform + params + parents).
    dims
        Output dimension names.
    shape
        Output shape.
    dtype
        Numpy dtype string.
    coords
        Coordinate metadata (name → values or summary).
    status
        Computation lifecycle: pending → computed → materialized; or error.
    data
        Populated after successful computation.
    cache_key
        For cache lookup; derived from provenance.
    error
        Error message if status == "error".
    """

    id: str
    provenance: TransformProvenance
    dims: tuple[str, ...]
    shape: tuple[int, ...]
    dtype: str
    coords: dict[str, Any] = field(default_factory=dict)
    status: Literal["pending", "computed", "materialized", "error"] = "pending"
    data: xr.DataArray | None = None
    cache_key: str | None = None
    error: str | None = None

    def __post_init__(self) -> None:
        if self.cache_key is None:
            self.cache_key = self.provenance.cache_key()

    def to_dict(self) -> dict[str, Any]:
        """Serialize metadata (not data) for session persistence."""
        return {
            "id": self.id,
            "provenance": self.provenance.to_dict(),
            "dims": list(self.dims),
            "shape": list(self.shape),
            "dtype": self.dtype,
            "coords": self.coords,
            "status": self.status,
            "cache_key": self.cache_key,
            "error": self.error,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> DerivedTensor:
        """Restore from serialized metadata (without computed data)."""
        return cls(
            id=data["id"],
            provenance=TransformProvenance.from_dict(data["provenance"]),
            dims=tuple(data["dims"]),
            shape=tuple(data["shape"]),
            dtype=data["dtype"],
            coords=data.get("coords", {}),
            status=data.get("status", "pending"),
            cache_key=data.get("cache_key"),
            error=data.get("error"),
        )

    @property
    def is_computed(self) -> bool:
        return self.status in ("computed", "materialized")
