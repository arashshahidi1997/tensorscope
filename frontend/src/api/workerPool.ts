/**
 * Two-worker round-robin pool for v2 Arrow decode.
 *
 * Per the transport survey: Neuroglancer uses one worker per chunk
 * download, with a 30 ms `chunkUpdateDeadline` to keep frame budget
 * intact; Perspective uses a single worker holding the whole engine.
 * Our scale is between the two — 2 workers (one for the active slice,
 * one for the next prefetch) is enough to keep `tableFromIPC` off the
 * main thread without spending memory on a larger pool.
 *
 * Each `submit(buffer, viewType)` returns a Promise that resolves with
 * the decoded value (a `LabeledTensor`, a `PSDHeatmapData`, etc — the
 * worker dispatches by `viewType`). The input `buffer` is consumed
 * (transferred); callers must not read from it again.
 *
 * Open question §6.4 of contract-v2.md: pair-mode browser clients ship
 * the bundled `src/tensorscope/static/` chunk-set, which must include
 * the worker chunk. Vite's `new Worker(new URL(...), { type: "module" })`
 * pattern emits the worker as a separate code-split chunk and
 * `frontend-build` syncs the whole `dist/` tree into `static/`, so the
 * worker travels with the rest of the bundle automatically. Verified
 * after the first `pixi run frontend-build` post this change.
 */

type PendingResolver = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  worker: Worker;
};

const POOL_SIZE = 2;

let _pool: WorkerPool | null = null;

class WorkerPool {
  private workers: Worker[];
  private nextWorker = 0;
  private nextId = 1;
  private pending = new Map<number, PendingResolver>();

  constructor(size: number = POOL_SIZE) {
    this.workers = [];
    for (let i = 0; i < size; i++) {
      this.workers.push(this.spawnWorker());
    }
  }

  private spawnWorker(): Worker {
    // Vite resolves this URL at build time and emits a separate worker
    // chunk. `type: "module"` is required for the worker file to use
    // `import` (apache-arrow ships ESM-only).
    const w = new Worker(new URL("./arrow.worker.ts", import.meta.url), { type: "module" });
    w.addEventListener("message", (e) => this.handleMessage(e));
    w.addEventListener("error", (e) => this.handleError(w, e));
    return w;
  }

  private handleMessage(e: MessageEvent<{ id: number; ok: boolean; value?: unknown; error?: string }>): void {
    const { id, ok, value, error } = e.data;
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    if (ok) pending.resolve(value);
    else pending.reject(new Error(error ?? "worker decode failed"));
  }

  private handleError(worker: Worker, e: ErrorEvent): void {
    // An ErrorEvent carries no request id, so we can't pinpoint the failed
    // decode — but we DO know which worker emitted it. Reject only THAT
    // worker's in-flight requests (siblings are unaffected, so a single bad
    // payload no longer fails every concurrent decode), then terminate and
    // replace the dead worker. Without the replacement the round-robin keeps
    // dispatching onto a crashed worker and those decodes hang forever.
    const err = new Error(`arrow.worker error: ${e.message}`);
    for (const [id, pending] of this.pending) {
      if (pending.worker === worker) {
        pending.reject(err);
        this.pending.delete(id);
      }
    }
    const idx = this.workers.indexOf(worker);
    if (idx !== -1) {
      try {
        worker.terminate();
      } catch {
        /* already dead */
      }
      this.workers[idx] = this.spawnWorker();
    }
  }

  submit<T>(buffer: ArrayBuffer, viewType: string): Promise<T> {
    const id = this.nextId++;
    const worker = this.workers[this.nextWorker];
    this.nextWorker = (this.nextWorker + 1) % this.workers.length;
    const submittedAt = performance.now();
    // Capture the byte length BEFORE postMessage transfers (and neuters) the
    // buffer — reading `buffer.byteLength` in the resolve closure would see 0.
    const byteLength = buffer.byteLength;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => {
          const elapsed = performance.now() - submittedAt;
          logWorkerDecodeTime(viewType, byteLength, elapsed);
          resolve(v as T);
        },
        reject,
        worker,
      });
      // Transfer the IPC buffer into the worker — zero-copy. Caller
      // must not touch `buffer` after this point.
      worker.postMessage({ id, buffer, viewType }, [buffer]);
    });
  }

  terminate(): void {
    for (const w of this.workers) {
      try {
        w.terminate();
      } catch {
        /* ignore */
      }
    }
    this.workers = [];
    for (const [, pending] of this.pending) {
      pending.reject(new Error("worker pool terminated"));
    }
    this.pending.clear();
  }
}

// One-shot per-viewType log so the user can verify worker decode time
// against the Phase 1 acceptance ("main-thread frame budget under 16 ms
// during pan" — postMessage round-trip should be a few ms, not tens).
// See `docs/design/contract-v2.md` Phase 1 acceptance criteria.
const _decodeLoggedViewTypes = new Set<string>();
function logWorkerDecodeTime(viewType: string, bytes: number, elapsedMs: number): void {
  if (_decodeLoggedViewTypes.has(viewType)) return;
  _decodeLoggedViewTypes.add(viewType);
  const mb = (bytes / 1024 / 1024).toFixed(2);
  const verdict = elapsedMs < 16 ? "WITHIN FRAME BUDGET" : "OVER 16ms BUDGET";
  // eslint-disable-next-line no-console
  console.info(
    `[contract-v2] worker decode ${viewType}: ${elapsedMs.toFixed(1)} ms for ${mb} MB ` +
      `(${verdict})`,
  );
}

/**
 * Lazy singleton — workers are spun up on first decode, not at module
 * load. Keeps the cost off the SSR / pre-mount path.
 */
export function getArrowWorkerPool(): WorkerPool {
  if (!_pool) _pool = new WorkerPool();
  return _pool;
}

/** For tests / teardown. */
export function _resetWorkerPool(): void {
  if (_pool) _pool.terminate();
  _pool = null;
}
