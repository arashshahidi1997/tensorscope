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
  fingerprintScope,
  useEventReviewStore,
  type EventDecision,
} from "../../store/eventReviewStore";

/**
 * Debounce window before auto-save fires. Long enough that a fast
 * burst of `j`/`y`/`n` keypresses coalesces into one POST; short
 * enough that a reviewer's accidental tab-close survives.
 */
const AUTOSAVE_DEBOUNCE_MS = 2000;

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
  // Last fingerprint we successfully shipped to disk. Compare against the
  // current local fingerprint to render the "N unsaved" dirty indicator
  // and to gate the auto-save effect.
  const [savedFingerprint, setSavedFingerprint] = useState<string | null>(null);
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

  // Stable content-addressed fingerprint of the current local scope.
  // Used by the dirty indicator and the auto-save debouncer.
  const localFingerprint = useMemo(
    () => fingerprintScope(decisions, tensorName, streamName),
    [decisions, tensorName, streamName],
  );

  // True when local state differs from the last successful save.
  // savedFingerprint===null means we never saved (or never confirmed),
  // so anything local counts as unsaved.
  const isDirty = savedFingerprint !== localFingerprint;

  // On mount and whenever (tensor, stream) changes, fetch the disk
  // version. If local is empty AND server has decisions, mirror them
  // into the store. This is what "reload the browser → status row
  // reads from disk" looks like in practice.
  const seedRanRef = useRef<string>("");
  useEffect(() => {
    const scopeKey = `${tensorName}|${streamName}`;
    // A scope change resets the "what's on disk" fingerprint snapshot —
    // it belongs to the previous scope, not this one.
    setSavedFingerprint(null);
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
          // After the seed, the local store mirrors disk — record that
          // fingerprint so the dirty indicator doesn't immediately
          // flag everything as unsaved.
          if (!cancelled) {
            setSavedFingerprint(
              fingerprintScope(
                useEventReviewStore.getState().decisions,
                tensorName,
                streamName,
              ),
            );
          }
        } else if (
          // Local non-empty AND server matches local → claim "saved" so
          // the dirty indicator stays calm. Common case: reload after a
          // successful export; localStorage and disk agree.
          !cancelled &&
          res.decisions.length > 0
        ) {
          const localFp = fingerprintScope(
            useEventReviewStore.getState().decisions,
            tensorName,
            streamName,
          );
          // Synthesise a fingerprint from the server payload by feeding
          // it through the store-shape (without mutating the store).
          const synthetic: typeof useEventReviewStore extends never
            ? never
            : Record<string, EventDecision> = {};
          for (const dto of res.decisions) {
            const { eventId, decision } = fromServerDecision(dto);
            synthetic[`${tensorName}|${streamName}|${eventId}`] = decision;
          }
          const diskFp = fingerprintScope(synthetic, tensorName, streamName);
          if (diskFp === localFp) setSavedFingerprint(localFp);
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

  // Capture the fingerprint at send time so we record exactly what we
  // shipped — concurrent edits while the request is in flight will then
  // show as dirty against the freshly-saved baseline (correct UX).
  const onExport = useCallback(async () => {
    const sentFp = localFingerprint;
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
      setSavedFingerprint(sentFp);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveState({ kind: "error", message });
    }
  }, [localScope, streamName, localFingerprint]);

  // Debounced auto-save. Fires when the local fingerprint hasn't been
  // shipped yet AND we're not currently in flight. The window is short
  // enough that a fast burst of keypresses coalesces; long enough that
  // accidental tab-close survives.
  //
  // Why a ref for the latest onExport: a fresh closure on every render
  // would re-arm the setTimeout, so the debounce would never fire on a
  // continuously-edited stream. The ref tracks the latest function but
  // the effect re-runs only on fingerprint change.
  const onExportRef = useRef(onExport);
  useEffect(() => {
    onExportRef.current = onExport;
  }, [onExport]);
  useEffect(() => {
    if (!disk.loaded) return; // wait for the initial GET to settle
    if (saveState.kind === "saving") return;
    if (!isDirty) return;
    if (localScope.length === 0 && savedFingerprint === null) return;
    const handle = window.setTimeout(() => {
      void onExportRef.current();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localFingerprint, disk.loaded, isDirty, saveState.kind]);

  // How many local entries differ from disk. Approximate — uses the
  // count difference plus a "fingerprint differs" boolean. The exact
  // diff-set isn't worth computing here; this is just a "you have N
  // unsaved" pressure on the reviewer.
  const localCount = localScope.length;
  const unsavedCount = isDirty
    ? Math.max(1, Math.abs(localCount - disk.n))
    : 0;

  // Status row text. Order of preference: most-recent save state > disk
  // snapshot. The two converge after a successful save. The dirty
  // suffix (" · N unsaved") appears whenever local diverges from the
  // last-confirmed save.
  const dirtySuffix: ReactNode = isDirty && disk.loaded ? (
    <>
      {" · "}
      <span className="export-dirty" data-testid="export-dirty">
        {unsavedCount} unsaved
      </span>
    </>
  ) : null;

  let status: ReactNode = null;
  if (saveState.kind === "saving") {
    status = <span className="muted">Saving decisions…</span>;
  } else if (saveState.kind === "error") {
    status = (
      <span className="export-status error" data-testid="export-error">
        Save failed: {saveState.message}
        {dirtySuffix}
      </span>
    );
  } else if (saveState.kind === "saved") {
    status = (
      <span className="muted" data-testid="export-status">
        Last saved: {timeAgo(saveState.at, now)} · {saveState.n} decisions on disk
        {dirtySuffix}
      </span>
    );
  } else if (disk.loaded && disk.savedAt != null) {
    status = (
      <span className="muted" data-testid="export-status">
        Last saved: {timeAgo(disk.savedAt, now)} · {disk.n} decisions on disk
        {dirtySuffix}
      </span>
    );
  } else if (disk.loaded) {
    status = (
      <span className="muted" data-testid="export-status">
        {localCount > 0
          ? `${localCount} decisions in local store — not yet saved`
          : "No decisions saved to disk yet."}
      </span>
    );
  }

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
