"""Pipeline specification data model.

A PipelineSpec is a curated projection of the workspace DAG
into a reproducible, serializable pipeline document.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


@dataclass
class PipelineSourceTensor:
    """A source (root) tensor in the pipeline."""
    tensor_id: str
    data_ref: str = ""  # file path, URI, or session key


@dataclass
class PipelineTransformNode:
    """A promoted transform node in the pipeline."""
    node_id: str
    transform_name: str
    params: dict[str, Any] = field(default_factory=dict)
    inputs: list[str] = field(default_factory=list)   # tensor_ids
    output: str = ""  # output tensor_id


@dataclass
class PipelineDerivedTensor:
    """A derived tensor declared in the pipeline."""
    tensor_id: str
    dims: tuple[str, ...] = ()
    dtype: str = ""


@dataclass
class ExecutionMetadata:
    """Metadata about pipeline creation context."""
    created_at: str = ""
    session_id: str = ""
    description: str = ""

    def __post_init__(self) -> None:
        if not self.created_at:
            self.created_at = datetime.now(timezone.utc).isoformat()


@dataclass
class PipelineSpec:
    """Complete pipeline specification document.

    Represents a curated, reproducible subset of the workspace DAG
    that can be serialized and optionally cooked into a workflow.
    """
    version: str = "1.0"
    name: str = ""
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    source_tensors: list[PipelineSourceTensor] = field(default_factory=list)
    transforms: list[PipelineTransformNode] = field(default_factory=list)
    derived_tensors: list[PipelineDerivedTensor] = field(default_factory=list)
    outputs: list[str] = field(default_factory=list)  # tensor_ids
    execution_metadata: ExecutionMetadata = field(default_factory=ExecutionMetadata)
    cooker_profile: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Serialize to a JSON-compatible dict."""
        return {
            "version": self.version,
            "name": self.name,
            "id": self.id,
            "source_tensors": [
                {"tensor_id": s.tensor_id, "data_ref": s.data_ref}
                for s in self.source_tensors
            ],
            "transforms": [
                {
                    "node_id": t.node_id,
                    "transform_name": t.transform_name,
                    "params": t.params,
                    "inputs": t.inputs,
                    "output": t.output,
                }
                for t in self.transforms
            ],
            "derived_tensors": [
                {"tensor_id": d.tensor_id, "dims": list(d.dims), "dtype": d.dtype}
                for d in self.derived_tensors
            ],
            "outputs": self.outputs,
            "execution_metadata": {
                "created_at": self.execution_metadata.created_at,
                "session_id": self.execution_metadata.session_id,
                "description": self.execution_metadata.description,
            },
            "cooker_profile": self.cooker_profile,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> PipelineSpec:
        """Deserialize from a dict."""
        meta = data.get("execution_metadata", {})
        return cls(
            version=data.get("version", "1.0"),
            name=data.get("name", ""),
            id=data.get("id", uuid.uuid4().hex[:12]),
            source_tensors=[
                PipelineSourceTensor(
                    tensor_id=s["tensor_id"],
                    data_ref=s.get("data_ref", ""),
                )
                for s in data.get("source_tensors", [])
            ],
            transforms=[
                PipelineTransformNode(
                    node_id=t["node_id"],
                    transform_name=t["transform_name"],
                    params=t.get("params", {}),
                    inputs=t.get("inputs", []),
                    output=t.get("output", ""),
                )
                for t in data.get("transforms", [])
            ],
            derived_tensors=[
                PipelineDerivedTensor(
                    tensor_id=d["tensor_id"],
                    dims=tuple(d.get("dims", ())),
                    dtype=d.get("dtype", ""),
                )
                for d in data.get("derived_tensors", [])
            ],
            outputs=data.get("outputs", []),
            execution_metadata=ExecutionMetadata(
                created_at=meta.get("created_at", ""),
                session_id=meta.get("session_id", ""),
                description=meta.get("description", ""),
            ),
            cooker_profile=data.get("cooker_profile"),
        )
