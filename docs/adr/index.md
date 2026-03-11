# TensorScope ADR Index

Architecture Decision Records capture durable technical decisions that are narrower than the full architecture doc and more stable than milestone prompts.

Use ADRs for:

- decisions that future agents should not silently re-litigate
- tradeoffs that need a short rationale
- choices that shape multiple milestones

Related docs:

- [Architecture overview](../architecture/tensorscope.md)
- [Architecture invariants](../architecture/invariants.md)
- [Context snapshot](../prompts/context_snapshot.md)

## ADR List

- [ADR-0001: Frontend Foundation](./0001-frontend-foundation.md)
- [ADR-0002: uPlot For Timeseries Rendering](./0002-uplot-timeseries-renderer.md)
- [ADR-0003: Workspace-Shell UI Architecture](./0003-workspace-shell-architecture.md)
- [ADR-0004: Shared SelectionState Coordination Layer](./0004-shared-selectionstate-coordination.md)
- [ADR-0005: CPU-First Rendering With Optional GPU Acceleration](./0005-cpu-first-rendering.md)
- [ADR-0006: Staged Prompt-Pack Development Model](./0006-staged-prompt-pack-development.md)

## Status guidance

Use cautious statuses unless the repo state clearly supports a stronger claim:

- `Accepted`: clearly implemented or consistently reflected in current docs and code
- `Proposed`: direction is documented but not fully settled in code
- `Superseded`: replaced by a newer ADR

When a major architectural decision changes, update the relevant ADR and also sync:

- [../architecture/tensorscope.md](../architecture/tensorscope.md)
- [../prompts/context_snapshot.md](../prompts/context_snapshot.md)
