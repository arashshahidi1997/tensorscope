# ADR-0003: Workspace-Shell UI Architecture

## Title

Workspace-shell architecture for TensorScope UI

## Status

Accepted

## Context

TensorScope is a linked exploration workspace, not a single-chart application. The UI needs durable structure around navigation, central views, and inspection.

## Decision

Organize the UI around a workspace shell with distinct navigation, main workspace, and inspector roles.

## Consequences

- shared controls belong in the shell, not inside arbitrary views
- the shell can host multiple coordinated views without view-to-view coupling
- view-specific controls should not accumulate in global rails without a clear reason

## Related docs

- [Architecture overview](../architecture/tensorscope.md)
- [Architecture invariants](../architecture/invariants.md)
- [M1 workspace-shell prompt](../prompts/tensorscope/03_workspace_shell.md)
