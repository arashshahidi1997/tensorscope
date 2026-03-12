# TensorScope MA1 Context

Use this file as the shared context preamble for MA1 tasks.

Read first:

- [../README.md](../README.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)
- [../../architecture/invariants.md](../../architecture/invariants.md)
- [../context_snapshot.md](../context_snapshot.md)
- [../tensorscope-m3/README.md](../tensorscope-m3/README.md)

## Conceptual architecture

MA1 introduces GPU-backed rendering as an optional acceleration layer for views that already have a correct CPU implementation.

Typical direction: WebGL or related GPU-backed rendering behind stable renderer abstractions.

## What this milestone enables

- higher-throughput spatial rendering
- smoother propagation visualization at larger channel counts
- renderer selection based on capability and workload

## Guardrails

- CPU-first rendering remains required
- GPU paths must stay behind stable renderer abstractions
- no core view may depend exclusively on GPU infrastructure

## Expected integration points

- spatial and propagation views from M3
- renderer abstraction work from M2 and M3
- later DAG and pipeline milestones only insofar as they need to visualize larger derived products
