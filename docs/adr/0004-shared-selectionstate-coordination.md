# ADR-0004: Shared SelectionState Coordination Layer

## Title

Shared SelectionState as the coordination layer across views

## Status

Accepted

## Context

TensorScope relies on linked views. Cross-view behavior becomes brittle if each view coordinates through custom callbacks or direct component coupling.

## Decision

Use shared `SelectionState` and adjacent shared navigation contracts as the primary coordination layer across views.

## Consequences

- views communicate by publishing and observing shared navigation state
- navigation state, view-local state, and processing state must remain distinct
- future agents should treat direct view-to-view coupling as an architectural regression

## Related docs

- [Architecture overview](../architecture/tensorscope.md)
- [Architecture invariants](../architecture/invariants.md)
- [M1 selection store prompt](../prompts/tensorscope/02_selection_store.md)
