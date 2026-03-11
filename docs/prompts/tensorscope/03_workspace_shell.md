# Prompt 03: Workspace Shell

Read first:

- [00_context.md](./00_context.md)
- [../context_snapshot.md](../context_snapshot.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: stabilize the workspace-shell structure around navigation, workspace, and inspector roles.

Inspect first:

- [frontend/src/App.tsx](/storage2/arash/projects/tensorscope/frontend/src/App.tsx)
- [frontend/src/components/layout/LayoutShell.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/layout/LayoutShell.tsx)

Scope:

- clarify shell composition in the frontend
- separate shared controls from view-specific controls
- preserve the current prototype layout where possible

Guardrails:

- do not redesign visual styling broadly
- do not implement new scientific views here
- do not hide architecture problems by stuffing more logic into `App.tsx`

Acceptance:

- shell responsibilities are easier to understand
- navigation and details rails are clearer
- future views can slot into the main workspace without shell rewrites
