# Prompt 12: DataSource Abstraction

Read first:

- [00_context.md](./00_context.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)
- [../context_snapshot.md](../context_snapshot.md)

Goal: define a generic `DataSource` abstraction for TensorScope views.

Scope:

- chunked tensor access
- async slice loading
- dimension-based addressing

Implementation Tasks:

- identify the current slice-loading path in the repo
- define the minimal `DataSource` contract needed by large-view consumers
- document how views request data without loading full tensors
- keep the abstraction small enough for current frontend and server use

Constraints:

- do not implement full data backends here if this is a docs-only pass
- do not couple views directly to one transport format
- label new modules as planned if the task only defines contracts

Acceptance Criteria:

- views can request time slices without loading full tensors
- the contract is compatible with shared navigation state
- the abstraction is explicit about async behavior and dimension-based access

Deliverables:

- concise prompt-guided spec for `DataSource`
- any small doc notes needed to link the spec back to current slice loading
