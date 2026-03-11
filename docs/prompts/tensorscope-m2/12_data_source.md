# Prompt 12: DataSource Abstraction

Read first:

- [00_context.md](./00_context.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)
- [../context_snapshot.md](../context_snapshot.md)

Goal: formalize the existing slice-loading contract as an explicit `DataSource` abstraction.

Current state:

The slice-loading path already exists in `frontend/src/api/queries.ts`:
`useSliceQuery(name, request)` is the async data-access hook; React Query
provides caching, deduplication, and stale-while-revalidate behavior;
`makeDefaultSliceRequest` and `makeNavigatorRequest` are the per-view request
factories.  Server-side windowing and downsampling (`apply_slice_request`,
`downsample_time_axis` with min/max and LTTB in `server/state.py`) handle all
aggregation — the client never loads the full tensor.  The task is to name and
document this implicit contract, not to build a new abstraction layer on top
of it.

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

## Reference

Perspective's `OptionalUpdate<T>` pattern (`rust/perspective-viewer/src/rust/config/viewer_config.rs`) is directly applicable to `TensorSliceRequestDTO`. Currently, every navigation state change re-sends the full DTO including unchanged dimensions (`spatial`, `freq`, `event`). Perspective wraps each mutable config field in a three-state enum: `Missing` (field absent — no change), `SetDefault` (null — reset to default), `Update(T)` (explicit value). In Pydantic terms, this maps to treating `None` as "no change" for each optional field:

```python
class TensorSliceRequestDTO(BaseModel):
    time_range: Optional[tuple[float, float]] = None  # None = keep current
    spatial:    Optional[SpatialSlice] = None          # None = keep current
    freq:       Optional[FreqSlice]    = None          # None = keep current
    event:      Optional[EventSlice]   = None          # None = keep current
```

The server's `apply_slice_request` already has the structure to apply only changed dimensions — this pattern makes the "no change" intent explicit in the wire contract rather than relying on the server to detect unchanged fields by value comparison.

Also applicable: Perspective's `UpdateOptions.port_id` — tagging each slice response with a source identifier to route incremental Arrow payloads to the correct view in multi-tensor sessions. In TensorScope's server, adding an optional `tensor_name` echo field to the response DTO would let the frontend route without matching on request parameters.

See [docs/reference-studies/perspective.md §2a, §4a](../../reference-studies/perspective.md).
