# Prompt 08: Tensor And View Registries

Read first:

- [00_context.md](./00_context.md)
- [../context_snapshot.md](../context_snapshot.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)
- [01_types.md](./01_types.md)

Goal: introduce minimal registry abstractions that match current reality and future growth.

Inspect first:

- [src/tensorscope/core/state.py](/storage2/arash/projects/tensorscope/src/tensorscope/core/state.py)
- [src/tensorscope/server/state.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/state.py)
- [frontend/src/registry/viewRegistry.ts](/storage2/arash/projects/tensorscope/frontend/src/registry/viewRegistry.ts)

Scope:

- tensor descriptor or metadata registry shape
- view registry contract for schema-to-view matching
- align existing frontend/backend lookup logic where practical
- label new registry modules as planned if the task only writes docs or contracts

Guardrails:

- do not over-design a plugin platform yet
- do not invent capabilities that the repo cannot support today

Acceptance:

- registry responsibilities are explicit
- future views and tensors can be added with less ad hoc branching
- the docs can refer to one registry model instead of multiple partial ones
