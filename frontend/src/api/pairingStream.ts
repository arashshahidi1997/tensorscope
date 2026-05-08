/**
 * SSE consumer for the agent-pairing API.
 *
 * Subscribes to `/api/v1/stream` and reflects external state mutations
 * (agent injections + selection updates) into the local Zustand store and
 * React Query cache so the browser updates without a reload.
 *
 * See `docs/log/idea/idea-arash-20260507-160104-478773.md`.
 */
import { useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { useSelectionStore } from "../store/selectionStore";
import type { SelectionDTO } from "./types";

type ViewportPayload = {
  time_range: [number, number] | null;
};

type StreamMessage =
  | { type: "tensor_added"; payload: Record<string, unknown> }
  | { type: "events_added"; payload: Record<string, unknown> }
  | { type: "selection_changed"; payload: SelectionDTO }
  | { type: "viewport_changed"; payload: ViewportPayload };

export interface PairingStreamOptions {
  /** Override constructor — useful for tests. Defaults to global EventSource. */
  eventSourceCtor?: typeof EventSource;
  /** Override URL — defaults to `/api/v1/stream`. */
  url?: string;
}

export function usePairingStream(
  queryClient: QueryClient,
  options: PairingStreamOptions = {},
): void {
  useEffect(() => {
    const Ctor = options.eventSourceCtor ?? (typeof EventSource !== "undefined" ? EventSource : null);
    if (!Ctor) return;
    const url = options.url ?? "/api/v1/stream";
    const es = new Ctor(url);
    es.onmessage = (ev) => handlePairingMessage(ev.data, queryClient);
    es.onerror = () => {
      // Browser EventSource auto-reconnects; nothing to do here.
    };
    return () => {
      es.close();
    };
  }, [queryClient, options.eventSourceCtor, options.url]);
}

/** Exported for unit testing. */
export function handlePairingMessage(raw: string, queryClient: QueryClient): void {
  let msg: StreamMessage;
  try {
    msg = JSON.parse(raw) as StreamMessage;
  } catch {
    return;
  }
  switch (msg.type) {
    case "tensor_added":
    case "events_added":
      queryClient.invalidateQueries({ queryKey: ["state"] });
      break;
    case "selection_changed":
      useSelectionStore.getState().initFromDTO(msg.payload);
      queryClient.invalidateQueries({ queryKey: ["slice"] });
      break;
    case "viewport_changed": {
      // Reuse selectionStore.timeWindow for now (the v2 viewportStore split
      // is deferred — see issue-arash-20260508-142724-956601.md). Phase 1
      // already wired setTimeWindow → chart.setScale, so this push reaches
      // the timeseries + spectrogram x-axes for free.
      const range = msg.payload?.time_range;
      if (Array.isArray(range) && range.length === 2 &&
          Number.isFinite(range[0]) && Number.isFinite(range[1])) {
        useSelectionStore.getState().setTimeWindow([range[0], range[1]]);
        queryClient.invalidateQueries({ queryKey: ["slice"] });
      }
      break;
    }
  }
}
