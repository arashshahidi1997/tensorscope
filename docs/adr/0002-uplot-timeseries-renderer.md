# ADR-0002: uPlot For Timeseries Rendering

## Title

uPlot as the baseline timeseries renderer

## Status

Accepted

## Context

TensorScope requires responsive dense timeseries rendering and overview/detail interaction. The repo already uses `uPlot` in timeseries and navigator views.

## Decision

Use `uPlot` as the baseline renderer for dense timeseries and overview timelines.

## Consequences

- timeseries interaction stays on a proven CPU-first path
- hot chart updates should use imperative `uPlot` APIs rather than React rerender loops
- future renderer abstractions must not break this baseline without a clear replacement

## Related docs

- [Architecture overview](../architecture/tensorscope.md)
- [Architecture invariants](../architecture/invariants.md)
- [M1 timeseries prompt](../prompts/tensorscope/04_timeseries_view.md)
