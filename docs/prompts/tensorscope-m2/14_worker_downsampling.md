# Prompt 14: Worker Downsampling

Read first:

- [00_context.md](./00_context.md)
- [13_lod_pipeline.md](./13_lod_pipeline.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: move client-side rendering work to a WebWorker to keep the UI thread responsive.

Current state:

All signal aggregation currently happens server-side (`downsample_time_axis`
with min/max and LTTB in `src/tensorscope/server/state.py`).  The client
receives pre-downsampled Arrow IPC payloads.  The work that belongs in a
worker is therefore client-side: Arrow IPC decode and canvas pixel-fill for
large spectrograms or dense timeseries.  Do not replicate server-side
aggregation logic in JS — that path already works.

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

## Reference

Neuroglancer's `worker_rpc.ts` / `render_layer_backend.ts` implement a structured main-thread ↔ WebWorker RPC with shared `rpcId` objects. The implementation detail is not portable (Neuroglancer has no backend; workers do the data fetching). The principle is: **the frontend must stay responsive even when data is late**. For TensorScope, the FastAPI backend plays the role of Neuroglancer's worker — data fetching is already off the UI thread. The remaining concern is client-side decode (Arrow IPC) and pixel-fill for dense spectrograms, which is the scope of this prompt. Stale result handling and cancellation should be explicit in the worker protocol — a result arriving after the user has panned away must be silently discarded rather than written to the canvas.

See [docs/reference-studies/neuroglancer.md §4.2](../../reference-studies/neuroglancer.md).
