# TensorScope Ontology

This folder contains the canonical conceptual model of TensorScope.
All definitions are derived from direct inspection of the repository —
`src/tensorscope/` (Python backend) and `frontend/src/` (TypeScript frontend).
Nothing here is speculative; every entity and relationship is grounded in
code evidence.

## Purpose

The ontology serves three roles:

1. **Shared vocabulary.** It defines the precise meaning of terms like
   *Tensor*, *Selection*, *View*, *Transform*, and *Session* as they are
   actually used in the codebase, not as they might be used generically.

2. **Navigation aid.** Each entity entry links to the files and classes that
   implement it, making it possible to jump from concept to code.

3. **Feature contract.** New features should identify which ontology entities
   they introduce, extend, or retire. A feature that adds a new view type
   touches the *View* entity, the *Layout* entity, and the server-side
   `_VIEW_REGISTRY`. Naming that explicitly prevents silent coupling.

## Contents

| File | Contents |
|---|---|
| [entities.md](entities.md) | Definitions of all 17 core entities with evidence, responsibilities, and relationships |
| [relationships.md](relationships.md) | Graph-style relationship model and five traced interaction examples |
| [architecture.md](architecture.md) | Mermaid conceptual entity diagram with colour-coded backend/frontend/boundary nodes |
| [layers.md](layers.md) | Six-layer architectural model with dependency rules |
| [terminology.md](terminology.md) | Naming inconsistencies and ambiguities found across backend, wire protocol, and frontend |

## Analysis Artifacts

The intermediate analysis that produced this ontology is preserved in:

[docs/dev/ontology-analysis/](../../dev/ontology-analysis/)

- `entity_inventory.md` — raw candidate entity list from code scanning
- `entity_code_map.md` — entity-to-code mapping with file locations and key functions

## Conventions

- Links to source files use paths relative to the repository root (e.g.
  `src/tensorscope/core/state.py`).
- Backend/frontend asymmetries are noted explicitly in entity entries.
- Relationship arrows use the form `Entity --relation--> Entity`.
