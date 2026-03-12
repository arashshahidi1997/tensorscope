# Prompt 48: Computation Workers

Read first:

- [00_context.md](./00_context.md)
- [40_transform_registry.md](./40_transform_registry.md)
- [42_spectrogram_tensor.md](./42_spectrogram_tensor.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: move heavy transforms to worker processes.

Scope:

- worker API
- task scheduling
- result messaging

Implementation Tasks:

- define the worker contract for transform execution
- specify task scheduling and result-message semantics
- describe cancellation or stale-result handling where needed
- keep worker execution aligned with derived-tensor outputs

Constraints:

- UI thread must remain responsive
- do not mix worker orchestration with view coordination logic
- keep the first worker API narrow and explicit

Acceptance Criteria:

- derived tensor computations run asynchronously
- worker request/response rules are explicit
- heavy transform execution no longer depends on the main UI loop

Deliverables:

- prompt-ready worker-computation spec
- explicit task scheduling and result-messaging contract

## Reference

The M2 worker downsampling prompt (`14_worker_downsampling.md`) established the basic principle (stale results must be discarded, not written to canvas). For M4's heavier transform workers (spectrogram FFT, coherence, PCA), two additional references:

**Comlink for worker RPC** (from the JupyterLite study, `jupyterlite/pyodide-kernel src/kernel.ts` + `comlink.worker.ts`): Comlink (`npm i comlink`) wraps a WebWorker with a transparent async proxy. In the worker: `expose({ computeSpectrogram, computeCoherence })`. On the main thread: `const worker = wrap<WorkerAPI>(new Worker(...))`. The call site is `await worker.computeSpectrogram(params)` — plain async/await, no manual `postMessage`/`onmessage` wiring. Cancellation uses `AbortSignal` passed through Comlink's transfer mechanism. For streaming results (intermediate frames during long PCA), mix Comlink for control messages with direct discriminated `postMessage` for the data frames — same split JupyterLite uses.

**`SharedArrayBuffer` deployment awareness**: if `AbortSignal` + synchronous early-exit is needed inside a worker (e.g., a spinning FFT loop that must stop mid-computation), `SharedArrayBuffer` enables `Atomics.load()` polling from inside the worker. This requires `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` headers on all FastAPI responses. If those headers are not in place, fall back to message-based abort (the worker checks a flag on each chunk boundary) — slightly coarser but no deployment dependency.

See [docs/reference-studies/jupyterlite.md §2.1, §2.2](../../reference-studies/jupyterlite.md).
Also see [docs/reference-studies/neuroglancer.md §4.2](../../reference-studies/neuroglancer.md) for the M2 stale-result discard principle.

**`BackgroundTaskScheduler` with per-transform deduplication** (from the HiGlass study): deduplication prevents the worker queue from filling with stale tasks when parameters change faster than the worker can process. Before enqueuing a new spectrogram compute for a given time window, drop any previously queued spectrogram compute for the same transform id. The scheduler uses `requestIdleCallback` so heavy transforms only run during idle time, keeping the UI thread responsive.

See [docs/reference-studies/higlass.md §2.4](../../reference-studies/higlass.md).

**`MovingWindowRenderTimer` adaptive throttle** (from the Perspective study): when workers report intermediate results at variable latency (e.g., per-channel FFT slices arriving during a long coherence computation), a fixed debounce interval is too aggressive for slow hardware and too sluggish for fast hardware. A 5-sample sliding window of result-delivery durations derives the correct throttle dynamically. Apply this at the worker message handler, not at the React re-render layer.

See [docs/reference-studies/perspective.md §4d](../../reference-studies/perspective.md).
