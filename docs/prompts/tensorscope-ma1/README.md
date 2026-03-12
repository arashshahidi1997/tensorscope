# TensorScope MA1 Prompt Pack

Milestone: MA1 - Optional GPU Rendering Acceleration

Read first:

- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)
- [../../architecture/invariants.md](../../architecture/invariants.md)
- [../context_snapshot.md](../context_snapshot.md)
- [../README.md](../README.md)
- [../tensorscope-m3/README.md](../tensorscope-m3/README.md)

## Milestone purpose

MA1 adds optional GPU acceleration for rendering paths that exceed practical CPU limits.

This is an optional MA track, not part of the core M4 through M6 milestone chain.

## Architectural role

MA1 is an advanced extension track. It accelerates existing view classes, especially spatial and propagation-heavy views, without redefining the core TensorScope architecture.

## Relationship to earlier milestones

- M3 establishes the core spatial and propagation contracts.
- MA1 adds acceleration behind those contracts after the CPU baseline is already valid.

## Key subsystems introduced

- WebGL-backed renderer paths
- renderer capability negotiation
- acceleration hooks for large-channel and animated spatial views
- optional optimization only; CPU-first baseline remains mandatory
