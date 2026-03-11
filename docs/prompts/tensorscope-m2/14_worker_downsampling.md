# Prompt 14: Worker Downsampling

Read first:

- [00_context.md](./00_context.md)
- [13_lod_pipeline.md](./13_lod_pipeline.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: move heavy signal aggregation to WebWorkers.

Scope:

- worker interface
- downsampling functions
- async message protocol

Implementation Tasks:

- define which aggregation work should leave the UI thread
- specify the worker request/response shape
- define ownership of cancellation and stale-result handling
- keep the design compatible with the planned `DataSource` and LOD pipeline

Constraints:

- do not route hover or other hot UI events through expensive worker chatter
- do not mix worker protocol design with renderer design
- keep the first worker contract narrow

Acceptance Criteria:

- UI thread stays responsive
- worker protocol supports async aggregation safely
- stale results can be ignored or canceled cleanly

Deliverables:

- prompt-ready worker contract
- bounded implementation scope for a future agent run
