# TensorScope MA2 Context

Use this file as the shared context preamble for MA2 tasks.

Read first:

- [../README.md](../README.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)
- [../../architecture/invariants.md](../../architecture/invariants.md)
- [../context_snapshot.md](../context_snapshot.md)
- [../tensorscope-m5/README.md](../tensorscope-m5/README.md)

## Conceptual architecture

MA2 exposes the TensorScope workspace through structured query and export surfaces. Typical examples include command palette actions, graph queries, and compact context packets for external assistants.

## What this milestone enables

- queryable workspace and graph inspection
- command-driven navigation and inspection
- structured context export for external agents
- lightweight machine-readable snapshots of current workspace state
- optional natural-language adapters layered on top of structured actions

## Guardrails

- these hooks must sit on top of existing workspace and graph models rather than inventing parallel state
- shared navigation state remains the cross-view coordination mechanism
- assistant integrations should consume structured contracts, not view internals
- this milestone is optional and must not block the core M4 through M6 path

## Expected integration points

- workspace shell and inspector surfaces from M1
- transform DAG model from M5
- export and snapshot contracts from M6
