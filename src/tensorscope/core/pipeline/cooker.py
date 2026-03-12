"""Workflow cookers: translate PipelineSpec into executable workflow artifacts.

A cooker is a pure function that reads a PipelineSpec and produces
workflow specification text. It does not write files or submit jobs.
"""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

from tensorscope.core.pipeline.spec import PipelineSpec


@dataclass
class WorkflowArtifact:
    """A generated workflow file."""
    filename: str
    content: str


class WorkflowCooker(ABC):
    """Abstract interface for workflow generation."""

    @abstractmethod
    def cook(self, spec: PipelineSpec) -> list[WorkflowArtifact]:
        """Generate workflow artifacts from a pipeline spec.

        Returns a list of (filename, content) pairs.
        Must be a pure function with no side effects.
        """


class SnakemakeCooker(WorkflowCooker):
    """Generate Snakemake workflow from PipelineSpec."""

    def cook(self, spec: PipelineSpec) -> list[WorkflowArtifact]:
        snakefile = self._generate_snakefile(spec)
        config = self._generate_config(spec)
        return [
            WorkflowArtifact(filename="Snakefile", content=snakefile),
            WorkflowArtifact(filename="config.yaml", content=config),
        ]

    def _generate_snakefile(self, spec: PipelineSpec) -> str:
        lines: list[str] = []
        lines.append(f'# Snakefile generated from pipeline: {spec.name}')
        lines.append(f'# Pipeline ID: {spec.id}')
        lines.append(f'configfile: "config.yaml"')
        lines.append("")

        # Rule all: target outputs
        output_files = [self._tensor_path(tid) for tid in spec.outputs]
        lines.append("rule all:")
        lines.append("    input:")
        for f in output_files:
            lines.append(f'        "{f}",')
        lines.append("")

        # One rule per transform
        for tx in spec.transforms:
            rule_name = self._rule_name(tx.transform_name, tx.node_id)
            input_files = [self._tensor_path(inp) for inp in tx.inputs]
            output_file = self._tensor_path(tx.output)

            lines.append(f"rule {rule_name}:")
            lines.append("    input:")
            for f in input_files:
                lines.append(f'        "{f}",')
            lines.append("    output:")
            lines.append(f'        "{output_file}"')
            if tx.params:
                lines.append("    params:")
                for k, v in sorted(tx.params.items()):
                    lines.append(f"        {k}={_snakemake_param_repr(v)},")
            lines.append("    shell:")
            param_args = " ".join(
                f"--{k} {{params.{k}}}" for k in sorted(tx.params)
            )
            input_arg = " ".join(f"{{input[{i}]}}" for i in range(len(input_files)))
            lines.append(
                f'        "tensorscope compute {tx.transform_name} '
                f'--inputs {input_arg} '
                f'--output {{output}} {param_args}"'
            )
            lines.append("")

        return "\n".join(lines)

    def _generate_config(self, spec: PipelineSpec) -> str:
        """Generate config.yaml with parameter overrides."""
        try:
            import yaml
        except ImportError:
            return json.dumps(self._config_dict(spec), indent=2)

        return yaml.dump(
            self._config_dict(spec),
            default_flow_style=False,
            sort_keys=False,
        )

    def _config_dict(self, spec: PipelineSpec) -> dict[str, Any]:
        config: dict[str, Any] = {
            "pipeline_name": spec.name,
            "pipeline_id": spec.id,
        }
        # Source tensor data references
        sources: dict[str, str] = {}
        for src in spec.source_tensors:
            sources[src.tensor_id] = src.data_ref or f"{src.tensor_id}.nc"
        config["source_tensors"] = sources

        # Per-transform parameters
        params: dict[str, dict[str, Any]] = {}
        for tx in spec.transforms:
            if tx.params:
                params[self._rule_name(tx.transform_name, tx.node_id)] = tx.params
        if params:
            config["parameters"] = params

        return config

    @staticmethod
    def _tensor_path(tensor_id: str) -> str:
        return f"{tensor_id}.nc"

    @staticmethod
    def _rule_name(transform_name: str, node_id: str) -> str:
        short = node_id.replace("tx_", "").replace("-", "_")[:16]
        return f"{transform_name}_{short}"


def _snakemake_param_repr(value: Any) -> str:
    """Format a parameter value for Snakemake params block."""
    if isinstance(value, str):
        return f'"{value}"'
    if isinstance(value, bool):
        return "True" if value else "False"
    if isinstance(value, (list, dict)):
        return json.dumps(value)
    return str(value)


def get_cooker(profile: str) -> WorkflowCooker:
    """Look up a workflow cooker by profile name."""
    cookers: dict[str, type[WorkflowCooker]] = {
        "snakemake": SnakemakeCooker,
    }
    if profile not in cookers:
        raise ValueError(
            f"Unknown cooker profile '{profile}'. "
            f"Available: {', '.join(sorted(cookers))}"
        )
    return cookers[profile]()
