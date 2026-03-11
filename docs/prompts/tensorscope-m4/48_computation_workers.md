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
