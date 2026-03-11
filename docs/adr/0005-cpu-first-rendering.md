# ADR-0005: CPU-First Rendering With Optional GPU Acceleration

## Title

CPU-first rendering with optional GPU acceleration

## Status

Accepted

## Context

TensorScope needs usable scientific views early, before a complete GPU rendering stack exists. The architecture doc and invariants already emphasize CPU-first delivery.

## Decision

Require a usable CPU rendering path for core views. Treat GPU acceleration as optional follow-on work where it materially improves performance.

## Consequences

- milestones can ship without blocking on WebGL/GPU infrastructure
- renderer abstractions should not assume GPU availability
- future GPU work must fit around a stable CPU baseline rather than replace it prematurely

## Related docs

- [Architecture overview](../architecture/tensorscope.md)
- [Architecture invariants](../architecture/invariants.md)
- [M2 renderer prompt](../prompts/tensorscope-m2/21_renderer_abstraction.md)
