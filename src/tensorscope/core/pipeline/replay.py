"""Pipeline replay: re-apply a serialised PipelineSpec against a workspace.

Given a PipelineSpec and a TransformExecutor whose tensor registry already
holds the named source tensors, walk the transforms in dependency order
and call the executor for each one. Output tensor IDs are taken verbatim
from the spec so derived tensors land at stable, user-controlled names.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from tensorscope.core.pipeline.spec import PipelineSpec
from tensorscope.core.transforms.executor import TransformExecutor


class PipelineReplayError(Exception):
    """Raised when a pipeline cannot be replayed against the current workspace."""


@dataclass
class PipelineReplayResult:
    """Outcome of replaying a pipeline.

    Attributes
    ----------
    executed
        Output tensor IDs of transforms that completed successfully.
    skipped
        Output tensor IDs that already existed in the registry and were
        kept as-is (no recomputation).
    errors
        Mapping of output tensor ID → error message for transforms that
        failed during replay. Replay continues past errors so the caller
        sees the full picture.
    """

    executed: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    errors: dict[str, str] = field(default_factory=dict)


def replay_pipeline(
    spec: PipelineSpec,
    executor: TransformExecutor,
    *,
    skip_existing: bool = True,
) -> PipelineReplayResult:
    """Re-execute the transforms in ``spec`` against ``executor``.

    Parameters
    ----------
    spec
        The pipeline to replay. ``spec.transforms`` must already be in
        topological order (as produced by ``extract_pipeline``); this
        function does not re-sort.
    executor
        TransformExecutor backed by a tensor registry that already
        contains the named source tensors.
    skip_existing
        If True, skip transforms whose declared output tensor ID already
        exists in the registry. If False, re-execute and let the executor
        decide whether to overwrite (current executor behaviour leaves
        existing entries in place; new derived state is still produced).

    Returns
    -------
    PipelineReplayResult

    Raises
    ------
    PipelineReplayError
        If a required source tensor is missing from the registry. Errors
        raised by individual transforms are captured into ``result.errors``
        rather than re-raised.
    """
    registry = executor._tensors  # noqa: SLF001 — internal API in same package

    missing_sources = [
        s.tensor_id for s in spec.source_tensors if s.tensor_id not in registry
    ]
    if missing_sources:
        raise PipelineReplayError(
            "Source tensors not loaded in workspace: "
            + ", ".join(sorted(missing_sources))
        )

    result = PipelineReplayResult()

    for tx in spec.transforms:
        if not tx.output:
            result.errors[tx.node_id] = (
                f"transform {tx.transform_name!r} has no output tensor_id"
            )
            continue

        if skip_existing and tx.output in registry:
            result.skipped.append(tx.output)
            continue

        missing_inputs = [tid for tid in tx.inputs if tid not in registry]
        if missing_inputs:
            result.errors[tx.output] = (
                "missing inputs: " + ", ".join(missing_inputs)
            )
            continue

        try:
            derived = executor.execute(
                tx.transform_name,
                tx.inputs,
                tx.params,
                tensor_id=tx.output,
            )
        except (KeyError, ValueError) as exc:
            result.errors[tx.output] = str(exc)
            continue

        if derived.status == "error":
            result.errors[tx.output] = derived.error or "unknown error"
        else:
            result.executed.append(tx.output)

    return result
