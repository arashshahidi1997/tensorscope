# TensorScope MA2 Prompt Pack

Milestone: MA2 - Optional Queryable Workspace And Assistant Hooks

Read first:

- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)
- [../../architecture/invariants.md](../../architecture/invariants.md)
- [../context_snapshot.md](../context_snapshot.md)
- [../README.md](../README.md)
- [../tensorscope-m5/README.md](../tensorscope-m5/README.md)

## Milestone purpose

MA2 adds optional structured query and assistant-integration capabilities around the TensorScope workspace.

This is an optional MA track, not part of the core M4 through M6 milestone chain.

## Architectural role

MA2 is an advanced extension track. It exposes existing workspace, graph, and tensor state through structured interfaces for command palettes, queries, and external agents.

## Relationship to earlier milestones

- M5 provides the workspace graph that becomes queryable.
- M6 provides exportable execution state that external agents may inspect or produce.
- MA2 layers structured access on top of those core models.

## Key subsystems introduced

- command palette or query entry points
- structured workspace query model
- context export for external assistants
- machine-readable workspace snapshots
- optional natural-language adapters only on top of structured actions
