/// <reference lib="webworker" />
/**
 * Arrow IPC decode worker — Phase 1 of contract-v2.
 *
 * Runs `tableFromIPC` + the v2 extractor entirely off the main thread, per
 * Neuroglancer's `QUEUED → DOWNLOADING → DECODED → RENDERABLE` chunk model
 * and Perspective's transferable-`ArrayBuffer` postMessage pattern.
 *
 * Wire protocol (see `WorkerPool` for the main-thread side):
 *   request:  { id: number, buffer: ArrayBuffer, viewType: string }
 *   response: { id: number, ok: true,  value: ExtractedV2 }
 *           | { id: number, ok: false, error: string }
 *
 * Decoded typed arrays are returned via the `transfer` list so the main
 * thread receives them zero-copy. The original IPC `buffer` is consumed
 * by the worker (sent via `transfer` from the caller) — never inspect
 * it on the caller side after submitting.
 */
import { decodeLabeledTensor, extractV2, transferablesFor } from "./v2-arrow";

type WorkerRequest = { id: number; buffer: ArrayBuffer; viewType: string };
type WorkerResponse =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string };

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const { id, buffer, viewType } = event.data;
  try {
    const labeled = decodeLabeledTensor(buffer);
    const value = extractV2(viewType, labeled);
    const transfer = transferablesFor(value);
    const response: WorkerResponse = { id, ok: true, value };
    ctx.postMessage(response, transfer);
  } catch (err) {
    const response: WorkerResponse = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    ctx.postMessage(response);
  }
});
