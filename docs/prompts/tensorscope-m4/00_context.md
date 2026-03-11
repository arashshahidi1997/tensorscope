# TensorScope M4 Context

Use this file as the shared context preamble for M4 tasks.

Read first:

- [../README.md](../README.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)
- [../../architecture/invariants.md](../../architecture/invariants.md)
- [../context_snapshot.md](../context_snapshot.md)
- [../tensorscope-m3/README.md](../tensorscope-m3/README.md)

## Relationship to previous milestones

- M1 establishes the architecture spine and shared navigation model.
- M2 adds scalable data access and linked scientific views.
- M3 adds spatial dynamics and propagation views.
- M4 builds on those layers by introducing an explicit analysis layer for derived tensors.

## Why analysis transforms must be separated from views

Analysis logic should not be hidden inside rendering components.

M4 moves TensorScope toward:

`tensor -> transform -> derived tensor -> view`

This keeps analysis extensible, reproducible, and reusable across views.

## Derived tensor concept

A derived tensor is a tensor product created from one or more input tensors through an explicit transform.

Typical examples:

- spectrogram
- PSD
- band power
- coherence
- event-aligned signals
- state-space trajectories

## Transform registry concept

Transforms should be registered, discoverable, and explicit about:

- input tensor requirements
- output tensor shape and coordinates
- provenance
- compatibility with downstream views

## Compute pipeline overview

M4 expects a compute pipeline that can:

- schedule heavier transforms outside the main UI loop
- emit derived tensors as first-class outputs
- preserve metadata and provenance
- support later caching and reuse

## Caching and worker-based computation

- heavier transforms should move toward worker-based computation
- repeated requests should eventually reuse cached derived tensors
- caching must preserve correctness and traceability

## Guardrails

- views should consume tensors, not compute them
- shared navigation state remains the coordination mechanism
- transform logic must not become an implicit side effect of view rendering
- worker and cache layers must preserve a correct CPU-first baseline

## M4 success condition

TensorScope can represent analysis outputs as explicit derived tensors that are reusable across views instead of recomputing them ad hoc inside those views.
