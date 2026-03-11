# Prompt 09: Inspector Panel

Read first:

- [00_context.md](./00_context.md)
- [../context_snapshot.md](../context_snapshot.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)
- [03_workspace_shell.md](./03_workspace_shell.md)
- [08_registries.md](./08_registries.md)

Goal: define or implement a clean inspector/details area for selected context.

Inspect first:

- [frontend/src/App.tsx](/storage2/arash/projects/tensorscope/frontend/src/App.tsx)
- [frontend/src/components/layout/LayoutShell.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/layout/LayoutShell.tsx)
- [frontend/src/components/views/EventTableView.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/EventTableView.tsx)

Scope:

- current tensor metadata
- selection summary
- event details
- lightweight view-specific inspection content where justified

Guardrails:

- keep the inspector read-mostly
- do not move primary navigation controls into the inspector
- do not let the inspector become a second sidebar grab-bag

Acceptance:

- the right-hand detail area has a clear purpose
- selection context is easier to understand during linked interactions
