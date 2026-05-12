/**
 * G9 — Export decisions controls.
 *
 * Renders the "Export decisions" button and a status row:
 *
 *   ┌────────────────────────────────────────────────────────┐
 *   │ [Export decisions]                                     │
 *   │ Last saved: 2 min ago · 312 decisions on disk          │
 *   └────────────────────────────────────────────────────────┘
 *
 * The "on disk" count is whatever the server-side parquet held the last
 * time we asked. On mount, the component does a GET to learn that count;
 * if the local store is empty for this (tensor, stream) scope and the
 * server has decisions, we mirror them into the store transparently —
 * reload-survival in one fetch.
 *
 * Anything more invasive (full conflict resolution, "do you want to
 * replace local edits with disk?") is deliberately deferred — the task
 * note calls this v0 single-user only.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../../api/client";
import type { EventDecisionDTO } from "../../api/types";
import {
  decisionsInScope,
  useEventReviewStore,
  type EventDecision,
} from "../../store/eventReviewStore";

type Props = {
  tensorName: string;
  streamName: string;
};

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number; n: number }
  | { kind: "error"; message: string };

type DiskState = {
  n: number;
  savedAt: number | null;
  loaded: boolean;
};

function timeAgo(epochMs: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - epochMs) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function toServerDecision(eventId: string, d: EventDecision): EventDecisionDTO {
  return {
    event_id: eventId,
    status: d.status,
    decided_at: d.decidedAt,
    notes: d.notes,
    tags: d.tags ?? [],
  };
}

function fromServerDecision(
  dto: EventDecisionDTO,
): { eventId: string | number; decision: EventDecision } {
  return {
    eventId: dto.event_id,
    decision: {
      status: dto.status,
      decidedAt: dto.decided_at,
      notes: dto.notes ?? undefined,
      tags: dto.tags ?? [],
    },
  };
}

export function ExportDecisionsControls({ tensorName, streamName }: Props) {
  const decisions = useEventReviewStore((s) => s.decisions);
  const replaceScope = useEventReviewStore((s) => s.replaceScope);

  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [disk, setDisk] = useState<DiskState>({ n: 0, savedAt: null, loaded: false });
  // "now" is refreshed once a minute so the "X min ago" label doesn't
  // freeze. We only refresh while we actually have a saved-at timestamp
  // to display.
  const [now, setNow] = useState(() => Date.now());

  // The set of decisions for this scope is computed every render —
  // cheap, since we already pay this cost in the table for the counter.
  const localScope = useMemo(
    () => decisionsInScope(decisions, tensorName, streamName),
    [decisions, tensorName, streamName],
  );

  // On mount and whenever (tensor, stream) changes, fetch the disk
  // version. If local is empty AND server has decisions, mirror them
  // into the store. This is what "reload the browser → status row
  // reads from disk" looks like in practice.
  const seedRanRef = useRef<string>("");
  useEffect(() => {
    const scopeKey = `${tensorName}|${streamName}`;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.importEventDecisions(streamName);
        if (cancelled) return;
        setDisk({
          n: res.decisions.length,
          savedAt: res.saved_at,
          loaded: true,
        });
        // Seed the store only once per (tensor, stream) — and only if
        // the local scope is empty. We don't want to clobber edits that
        // the user is in the middle of making.
        const stillEmpty = decisionsInScope(
          useEventReviewStore.getState().decisions,
          tensorName,
          streamName,
        ).length === 0;
        if (
          stillEmpty &&
          res.decisions.length > 0 &&
          seedRanRef.current !== scopeKey
        ) {
          seedRanRef.current = scopeKey;
          replaceScope(
            tensorName,
            streamName,
            res.decisions.map(fromServerDecision),
          );
        }
      } catch {
        // Server may not support the endpoint (older builds) or the
        // dataset may not have a writable sidecar yet — neither is an
        // error worth surfacing here, just leave the disk state empty.
        if (!cancelled) {
          setDisk({ n: 0, savedAt: null, loaded: true });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tensorName, streamName, replaceScope]);

  useEffect(() => {
    if (disk.savedAt == null && saveState.kind !== "saved") return;
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, [disk.savedAt, saveState.kind]);

  const onExport = useCallback(async () => {
    setSaveState({ kind: "saving" });
    try {
      const payload = {
        decisions: localScope.map(({ eventId, decision }) =>
          toServerDecision(eventId, decision),
        ),
      };
      const res = await api.exportEventDecisions(streamName, payload);
      setSaveState({
        kind: "saved",
        at: res.saved_at,
        n: res.n_decisions,
      });
      setDisk({ n: res.n_decisions, savedAt: res.saved_at, loaded: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveState({ kind: "error", message });
    }
  }, [localScope, streamName]);

  // Status row text. Order of preference: most-recent save state > disk
  // snapshot. The two converge after a successful save.
  let status: ReactNode = null;
  if (saveState.kind === "saving") {
    status = <span className="muted">Saving decisions…</span>;
  } else if (saveState.kind === "error") {
    status = (
      <span className="export-status error" data-testid="export-error">
        Save failed: {saveState.message}
      </span>
    );
  } else if (saveState.kind === "saved") {
    status = (
      <span className="muted" data-testid="export-status">
        Last saved: {timeAgo(saveState.at, now)} · {saveState.n} decisions on disk
      </span>
    );
  } else if (disk.loaded && disk.savedAt != null) {
    status = (
      <span className="muted" data-testid="export-status">
        Last saved: {timeAgo(disk.savedAt, now)} · {disk.n} decisions on disk
      </span>
    );
  } else if (disk.loaded) {
    status = (
      <span className="muted" data-testid="export-status">
        No decisions saved to disk yet.
      </span>
    );
  }

  const localCount = localScope.length;
  const exportDisabled = saveState.kind === "saving";

  return (
    <div className="export-decisions-row">
      <button
        type="button"
        className="export-decisions-btn"
        onClick={onExport}
        disabled={exportDisabled}
        data-testid="export-decisions-btn"
        title={
          localCount === 0
            ? "No decisions in this scope to export"
            : `Save ${localCount} decision${localCount === 1 ? "" : "s"} to disk`
        }
      >
        Export decisions
      </button>
      <span className="export-decisions-status">{status}</span>
    </div>
  );
}
