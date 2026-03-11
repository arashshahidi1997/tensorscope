# Prompt 40: Transform Registry

Read first:

- [00_context.md](./00_context.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)
- [../../architecture/invariants.md](../../architecture/invariants.md)

Goal: introduce a `TransformRegistry` system.

Scope:

- register transforms
- define transform inputs and outputs
- declare tensor compatibility

Implementation Tasks:

- define the minimum transform-registry contract
- specify how transforms declare input requirements and output tensor shape
- describe how transforms are discovered by the system
- keep the registry compatible with existing tensor and view registry direction

Constraints:

- transforms must map `input tensor -> derived tensor`
- do not hide compatibility rules inside individual views
- label new modules as planned if this task remains contract-first

Acceptance Criteria:

- transforms can be registered and discovered by the system
- transform inputs and outputs are explicit
- compatibility rules are documented rather than implicit

Deliverables:

- prompt-ready transform-registry contract
- explicit registration and discovery rules
