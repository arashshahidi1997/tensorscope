# Prompt 01: Types And Contracts

Read first:

- [00_context.md](./00_context.md)
- [../context_snapshot.md](../context_snapshot.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: define the stable TypeScript domain contracts for TensorScope milestone M1.

Inspect first:

- [frontend/src/store/appStore.ts](/storage2/arash/projects/tensorscope/frontend/src/store/appStore.ts)
- [frontend/src/api/types.ts](/storage2/arash/projects/tensorscope/frontend/src/api/types.ts)
- [src/tensorscope/server/models.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/models.py)

Scope:

- shared selection/navigation types
- tensor metadata types
- minimal view descriptor types
- explicit separation between navigation state, view-local state, and processing state

Deliverables:

- small typed modules, not broad refactors
- comments only where the contract is non-obvious
- short doc note if the final shapes differ from the current roadmap assumptions
- planned abstractions labeled as planned if no concrete module exists yet

Guardrails:

- do not build the store yet
- do not refactor rendering code yet
- prefer minimal types that match the current repo and can extend later

Acceptance:

- future steps can import one stable contract instead of redefining ad hoc shapes
- time cursor, visible time range, event selection, and spatial selection are explicit
