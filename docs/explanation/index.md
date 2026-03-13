# Explanation

Understanding-oriented docs that explain why TensorScope is designed the way it is.

Use explanation for concepts, tradeoffs, and architecture decisions. This section should answer questions such as:

- why TensorScope is organized around tensors rather than plots
- why shared selection is the cross-view contract
- why Arrow IPC slices are returned from the server
- why the rendering path is CPU-first today
- why layout remains slot-based instead of fully freeform

Existing explanation-heavy material:

- [TensorScope architecture](../architecture/tensorscope.md)
- [Architecture invariants](../architecture/invariants.md)
- [Transform DAG](../architecture/transform-dag.md)
- [Pipeline export](../architecture/pipeline-export.md)
- [UI layout concepts](../design/ui-layout-concepts.md)
- [ADR index](../adr/index.md)

Related:

- [Diataxis map](../diataxis.md)
- [Reference studies](../reference-studies/index.md)
