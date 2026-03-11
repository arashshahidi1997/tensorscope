# TensorScope M3 Context

Use this file as the shared context preamble for M3 tasks.

Read first:

- [../README.md](../README.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)
- [../../architecture/invariants.md](../../architecture/invariants.md)
- [../context_snapshot.md](../context_snapshot.md)
- [../tensorscope-m2/README.md](../tensorscope-m2/README.md)

## Relationship to previous milestones

- M1 establishes the architectural spine: shared navigation state, shell boundaries, linked overview/detail behavior.
- M2 adds scalable data access and core scientific views.
- M3 builds on both by introducing spatial exploration of neural activity over electrode geometry.

## Architectural assumptions

- TensorScope still has four layers: Domain, Server/API, Workspace shell, and Views.
- Shared navigation state remains the coordination mechanism.
- Views must not call each other directly.
- Navigation state, view-local state, and processing state stay distinct.

## Spatial visualization goals

M3 introduces spatial exploration of spatiotemporal structure, including:

- electrode geometry
- spatial activity maps
- propagation animations
- phase and power maps
- spatial brushing and selection
- event-centered spatial dynamics

## Rendering policy

- CPU-first rendering remains required.
- Spatial views should start with Canvas-capable paths.
- GPU acceleration is future optional acceleration, not a requirement for correctness or basic usability.

## Guardrails for spatial views

- spatial views must integrate with shared `SelectionState` rather than inventing a parallel coordination model
- spatial linking should happen through shared state and shared contracts
- hot hover, scrub, and animation paths must avoid React rerender loops
- renderer abstractions must preserve a fully functional CPU path

## M3 success condition

Users can explore how activity propagates across electrodes through linked spatial views without breaking the earlier milestone architecture.
