"""Pipeline export: serialize PipelineSpec to JSON/YAML."""

from __future__ import annotations

import json
from typing import Any

from tensorscope.core.pipeline.spec import PipelineSpec


def export_json(spec: PipelineSpec, *, indent: int = 2) -> str:
    """Export pipeline spec as JSON string."""
    return json.dumps(spec.to_dict(), indent=indent, sort_keys=False)


def export_yaml(spec: PipelineSpec) -> str:
    """Export pipeline spec as YAML string.

    Falls back to JSON if PyYAML is not available.
    """
    try:
        import yaml
    except ImportError:
        return export_json(spec)

    return yaml.dump(
        spec.to_dict(),
        default_flow_style=False,
        sort_keys=False,
        allow_unicode=True,
    )


def import_json(text: str) -> PipelineSpec:
    """Import pipeline spec from JSON string."""
    data = json.loads(text)
    return PipelineSpec.from_dict(data)


def import_yaml(text: str) -> PipelineSpec:
    """Import pipeline spec from YAML string.

    Falls back to JSON parser if PyYAML is not available.
    """
    try:
        import yaml
    except ImportError:
        return import_json(text)

    data = yaml.safe_load(text)
    return PipelineSpec.from_dict(data)


def export_pipeline(spec: PipelineSpec, fmt: str = "json") -> str:
    """Export pipeline spec in the given format.

    Parameters
    ----------
    spec : PipelineSpec
    fmt : str
        "json" or "yaml"

    Returns
    -------
    str
    """
    if fmt == "yaml":
        return export_yaml(spec)
    return export_json(spec)
