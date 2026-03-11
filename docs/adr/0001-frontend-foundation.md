# ADR-0001: Frontend Foundation

## Title

React + TypeScript + Zustand as frontend foundation

## Status

Accepted

## Context

TensorScope needs a frontend stack that supports linked scientific views, strong type contracts, and incremental architecture work across milestones. The current repo already contains a React/TypeScript frontend and Zustand-backed client state.

## Decision

Use React + TypeScript as the primary frontend application foundation, with Zustand for client-side state where shared frontend state is needed.

## Consequences

- view composition and shell structure are React-based
- shared navigation contracts can be typed explicitly
- state design must stay disciplined so Zustand stores do not become catch-all containers

## Related docs

- [Architecture overview](../architecture/tensorscope.md)
- [Architecture invariants](../architecture/invariants.md)
- [M1 prompt pack](../prompts/tensorscope/README.md)
