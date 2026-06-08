import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { EventRecordDTO, EventStreamMetaDTO } from "../../api/types";
import { toNumber } from "../../api/arrow";
import {
  coincidenceIndicesByStream,
  countActiveStreamCoincidences,
  extractEventTimes,
} from "../../api/coincidence";
import {
  countReviewedInScope,
  decisionKey,
  useEventReviewStore,
  type EventReviewStatus,
} from "../../store/eventReviewStore";
import { useAppStore } from "../../store/appStore";
import { useSelectionStore } from "../../store/selectionStore";
import { EVENT_WINDOW_HALF_S } from "../../api/queries";
import {
  AnnotationPopover,
  type AnnotationPopoverValue,
} from "./AnnotationPopover";
import { ExportDecisionsControls } from "./ExportDecisionsControls";
import { EventFilterPanel } from "./EventFilterPanel";
import {
  nextSortState,
  sortEventRecords,
  type EventTableSort,
} from "./eventTableSort";
import { eventTimeRange } from "../../api/queries";

const NOTES_PREVIEW_LEN = 30;

function previewNotes(notes: string | undefined): string {
  if (!notes) return "";
  const trimmed = notes.replace(/\s+/g, " ").trim();
  if (trimmed.length <= NOTES_PREVIEW_LEN) return trimmed;
  return `${trimmed.slice(0, NOTES_PREVIEW_LEN - 1)}…`;
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

type StatusFilter = "all" | "pending" | "accepted" | "rejected" | "maybe";

type Props = {
  /** Active tensor — needed to scope decisions per dataset. */
  tensorName: string | null;
  /** Every available stream from /api/v1/state — used for the +add dropdown. */
  streams: EventStreamMetaDTO[];
  /** User-pinned stream names; first entry's color reflects palette order. */
  pinnedStreams: string[];
  /** Pinned stream currently shown in the table. */
  activeStreamName: string | null;
  /** Color per pinned stream — used for the chip dots and matches the
   *  per-stream timeseries marker color. */
  streamColors: Map<string, string>;
  /** Window query result per pinned stream (post property-filter). Streams
   *  without a fetch yet are absent. */
  eventsByStream: Map<string, EventRecordDTO[]>;
  /** Unfiltered window query result — feeds the filter panel's distribution
   *  histograms so they don't collapse as filters tighten (E2). */
  rawEventsByStream: Map<string, EventRecordDTO[]>;
  /** Seconds; tolerance for the coincidence summary. */
  coincidenceWindow: number;
  selectedTime: number;
  /** Identity of the currently active event row (from selectionStore.event.eventId). */
  selectedEventId?: string | number | null;
  onSelectTime: (t: number) => void;
  /**
   * Called when the user clicks an event row.
   * The caller should update selectionStore.event AND commit the time cursor.
   */
  onSelectEvent?: (eventId: string | number, streamName: string, t: number) => void;
  /**
   * Inspect an event at full resolution in a tight clamped window (additive
   * "inspect one detected event" feature). `span` is the event's `[t0, t1]`
   * start/stop if the record carries one (else null → point event). The caller
   * re-frames the timeseries and switches it to `downsample:"none"`.
   */
  onInspectEvent?: (
    eventId: string | number,
    streamName: string,
    t: number,
    span?: [number, number] | null,
  ) => void;
  onPrev: () => void;
  onNext: () => void;
  onActivateStream: (name: string) => void;
  onPinStream: (name: string) => void;
  onUnpinStream: (name: string) => void;
  onCoincidenceWindowChange: (s: number) => void;
};

const STATUS_GLYPH: Record<EventReviewStatus, string> = {
  accepted: "✓",
  rejected: "✗",
  maybe: "?",
};

const STATUS_LABEL: Record<StatusFilter, string> = {
  all: "All",
  pending: "Pending",
  accepted: "Accepted",
  rejected: "Rejected",
  maybe: "Maybe",
};

export function EventTableView({
  tensorName,
  streams,
  pinnedStreams,
  activeStreamName,
  streamColors,
  eventsByStream,
  rawEventsByStream,
  coincidenceWindow,
  selectedTime,
  selectedEventId,
  onSelectTime,
  onSelectEvent,
  onInspectEvent,
  onPrev,
  onNext,
  onActivateStream,
  onPinStream,
  onUnpinStream,
  onCoincidenceWindowChange,
}: Props) {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<EventTableSort>({ column: null, direction: "asc" });
  const [popoverEventId, setPopoverEventId] = useState<string | number | null>(null);
  // Channel scope for the window list (1b). Default "all": per-channel
  // streams have few/no events on the default (0,0) cell, which used to
  // leave the review list (and j/k/inspect) silently empty.
  const eventChannelScope = useAppStore((s) => s.eventChannelScope);
  const setEventChannelScope = useAppStore((s) => s.setEventChannelScope);
  const scopeAp = useSelectionStore((s) => s.spatial.ap);
  const scopeMl = useSelectionStore((s) => s.spatial.ml);
  const decisions = useEventReviewStore((s) => s.decisions);
  const setDecisionAction = useEventReviewStore((s) => s.setDecision);
  const clearDecisionAction = useEventReviewStore((s) => s.clearDecision);
  const updateNotesAction = useEventReviewStore((s) => s.updateNotes);
  const updateTagsAction = useEventReviewStore((s) => s.updateTags);

  const streamMeta = useMemo<EventStreamMetaDTO | null>(
    () => streams.find((s) => s.name === activeStreamName) ?? null,
    [streams, activeStreamName],
  );
  const events = useMemo<EventRecordDTO[]>(
    () => (activeStreamName ? eventsByStream.get(activeStreamName) ?? [] : []),
    [eventsByStream, activeStreamName],
  );
  // Unfiltered active-stream records — drives the filter panel's distribution
  // histograms (which must not collapse as the user tightens thresholds).
  const rawEvents = useMemo<EventRecordDTO[]>(
    () => (activeStreamName ? rawEventsByStream.get(activeStreamName) ?? [] : []),
    [rawEventsByStream, activeStreamName],
  );

  // Coincidence summary count for the active stream (against every other
  // pinned stream within `coincidenceWindow`).
  const coincidenceCount = useMemo(() => {
    if (!activeStreamName || pinnedStreams.length < 2) return 0;
    const byStream = new Map<string, ReturnType<typeof extractEventTimes>>();
    for (const name of pinnedStreams) {
      const recs = eventsByStream.get(name);
      const meta = streams.find((s) => s.name === name) ?? null;
      if (!recs) continue;
      byStream.set(name, extractEventTimes(recs, meta));
    }
    return countActiveStreamCoincidences(byStream, activeStreamName, coincidenceWindow);
  }, [activeStreamName, pinnedStreams, eventsByStream, streams, coincidenceWindow]);

  // Map event IDs → status for the visible window. Computed once per render.
  const idToStatus = useMemo<Map<string | number, EventReviewStatus>>(() => {
    if (!tensorName || !streamMeta) return new Map();
    const m = new Map<string | number, EventReviewStatus>();
    for (const ev of events) {
      const id = (ev.record as Record<string, unknown>)[streamMeta.id_col] as
        | string
        | number
        | undefined;
      if (id == null) continue;
      const d = decisions[decisionKey(tensorName, streamMeta.name, id)];
      if (d) m.set(id, d.status);
    }
    return m;
  }, [decisions, events, streamMeta, tensorName]);

  const counter = useMemo(() => {
    if (!tensorName || !streamMeta) return { reviewed: 0, total: 0 };
    const ids: Array<string | number> = [];
    for (const ev of events) {
      const id = (ev.record as Record<string, unknown>)[streamMeta.id_col] as
        | string
        | number
        | undefined;
      if (id != null) ids.push(id);
    }
    return countReviewedInScope(decisions, tensorName, streamMeta.name, ids);
  }, [decisions, events, streamMeta, tensorName]);

  // Index of coincident events in the active stream (window-scoped) — used
  // to ring matching rows in the table so the reviewer can spot a
  // candidate-vs-detector overlap without leaving the panel.
  const activeCoincidentIdx = useMemo<Set<number>>(() => {
    if (!activeStreamName || pinnedStreams.length < 2) return new Set();
    const byStream = new Map<string, ReturnType<typeof extractEventTimes>>();
    for (const name of pinnedStreams) {
      const recs = eventsByStream.get(name);
      const meta = streams.find((s) => s.name === name) ?? null;
      if (!recs) continue;
      byStream.set(name, extractEventTimes(recs, meta));
    }
    const all = coincidenceIndicesByStream(byStream, coincidenceWindow);
    return all.get(activeStreamName) ?? new Set();
  }, [activeStreamName, pinnedStreams, eventsByStream, streams, coincidenceWindow]);

  // 'e' opens the annotation popover for the currently selected event.
  // Matches Neuroscope2's "edit cluster" gesture. Bails inside inputs so
  // typing 'e' in the PSD/tags fields doesn't fire.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "e") return;
      if (isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!streamMeta || selectedEventId == null) return;
      e.preventDefault();
      setPopoverEventId(selectedEventId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [streamMeta, selectedEventId]);

  // Close the popover when the table's active stream changes — the
  // popover-scoped eventId would otherwise become meaningless.
  useEffect(() => {
    setPopoverEventId(null);
  }, [tensorName, streamMeta?.name]);

  // Streams not yet pinned — the +add dropdown shows these.
  const unpinned = useMemo(
    () => streams.filter((s) => !pinnedStreams.includes(s.name)),
    [streams, pinnedStreams],
  );

  // Filtered + sorted visible rows. Filtering is by review status; sorting is by
  // the clicked column header (additive — `sort.column` null = natural order).
  // We sort a decorated record array (each carrying its original index, so the
  // coincidence-ring lookup and React keys stay intact) via the pure, unit-tested
  // `sortEventRecords`. `__idx` is a private decoration the sort never targets.
  const visibleEvents = useMemo(() => {
    if (!streamMeta) return [] as Array<{ ev: EventRecordDTO; idx: number }>;
    const filtered = events
      .map((ev, idx) => ({ ev, idx }))
      .filter(({ ev }) => {
        if (filter === "all") return true;
        const id = (ev.record as Record<string, unknown>)[streamMeta.id_col] as
          | string
          | number
          | undefined;
        const status = id != null ? idToStatus.get(id) : undefined;
        if (filter === "pending") return status === undefined;
        return status === filter;
      });
    if (!sort.column) return filtered;
    const decorated = filtered.map(({ ev, idx }) => ({
      ...(ev.record as Record<string, unknown>),
      __idx: idx,
    }));
    const sorted = sortEventRecords(decorated, sort);
    return sorted.map(
      (d) => filtered.find((e) => e.idx === (d.__idx as number))!,
    );
  }, [events, streamMeta, filter, idToStatus, sort]);

  // Resolve a row's (eventId, t, span) for the inspect action. `span` is the
  // event's [t0, t1] if the record carries start/stop (or duration); else null.
  const resolveInspectTarget = useCallback(
    (record: Record<string, unknown>) => {
      if (!streamMeta) return null;
      const t = toNumber(record.t ?? record[streamMeta.time_col]);
      const eventId = record[streamMeta.id_col];
      if (t === null || eventId == null) return null;
      const span = eventTimeRange(record, streamMeta.time_col);
      // A zero-width span (point event) → null, so inspectWindowFor pads it.
      const useSpan = span && span[1] > span[0] ? span : null;
      return { eventId: eventId as string | number, t, span: useSpan };
    },
    [streamMeta],
  );

  // Inspect a specific visible row by its position in the (sorted) list.
  const inspectByPosition = useCallback(
    (pos: number) => {
      if (!streamMeta || !onInspectEvent) return;
      const entry = visibleEvents[pos];
      if (!entry) return;
      const target = resolveInspectTarget(entry.ev.record as Record<string, unknown>);
      if (!target) return;
      onInspectEvent(target.eventId, streamMeta.name, target.t, target.span);
    },
    [streamMeta, onInspectEvent, visibleEvents, resolveInspectTarget],
  );

  // Position of the active event within the sorted visible list (−1 if none).
  const activePos = useMemo(() => {
    if (!streamMeta || selectedEventId == null) return -1;
    return visibleEvents.findIndex(
      ({ ev }) =>
        (ev.record as Record<string, unknown>)[streamMeta.id_col] === selectedEventId,
    );
  }, [visibleEvents, streamMeta, selectedEventId]);

  // Step prev/next through the sorted list, re-framing the inspect window each
  // step. Wraps to the first/last when nothing is selected yet.
  const inspectStep = useCallback(
    (dir: -1 | 1) => {
      if (visibleEvents.length === 0) return;
      const base = activePos < 0 ? (dir === 1 ? -1 : visibleEvents.length) : activePos;
      const next = Math.min(visibleEvents.length - 1, Math.max(0, base + dir));
      inspectByPosition(next);
    },
    [visibleEvents.length, activePos, inspectByPosition],
  );

  // Hotkeys: Enter inspects the active row at full resolution; "," / "." step
  // prev/next through the sorted list (each re-framing the tight window).
  // [ and ] are taken by channel-scroll, j/k by event review — so we use , / .
  // Bails inside inputs and when nothing actionable is selected.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!streamMeta || !onInspectEvent) return;
      if (e.key === "Enter") {
        if (activePos < 0) return;
        e.preventDefault();
        inspectByPosition(activePos);
      } else if (e.key === ",") {
        e.preventDefault();
        inspectStep(-1);
      } else if (e.key === ".") {
        e.preventDefault();
        inspectStep(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [streamMeta, onInspectEvent, activePos, inspectByPosition, inspectStep]);

  if (streams.length === 0) {
    return (
      <div className="control-stack">
        <div className="panel-heading"><h2>Events</h2><p>No event streams loaded.</p></div>
      </div>
    );
  }

  const cols = streamMeta ? streamMeta.columns.slice(0, 6) : [];

  // Commit the popover edits — funnels into the store actions. "pending"
  // status drops the entire decision (notes/tags don't survive that, per
  // the v0 trade-off in the store header).
  const commitAnnotation = (
    eventId: string | number,
    next: AnnotationPopoverValue,
  ) => {
    if (!tensorName || !streamMeta) return;
    const dk = decisionKey(tensorName, streamMeta.name, eventId);
    if (next.status === "pending") {
      clearDecisionAction(dk);
    } else {
      setDecisionAction(dk, next.status);
      updateNotesAction(dk, next.notes);
      updateTagsAction(dk, next.tags);
    }
    setPopoverEventId(null);
  };

  return (
    <div className="control-stack">
      {/* Streams strip — pinned chips + +add dropdown */}
      <div className="event-streams-strip" role="group" aria-label="Pinned event streams">
        <span className="muted">Streams:</span>
        {pinnedStreams.map((name) => {
          const color = streamColors.get(name) ?? "#888";
          const isActive = name === activeStreamName;
          return (
            <span
              key={name}
              className={`event-stream-chip${isActive ? " active" : ""}`}
              data-testid={`event-stream-chip-${name}`}
            >
              <button
                type="button"
                className="event-stream-name"
                onClick={() => onActivateStream(name)}
                title={`Show ${name} in table`}
              >
                <span
                  className="event-stream-dot"
                  style={{ background: color }}
                  aria-hidden="true"
                />
                {name}
              </button>
              {pinnedStreams.length > 1 && (
                <button
                  type="button"
                  className="event-stream-close"
                  onClick={() => onUnpinStream(name)}
                  aria-label={`Unpin ${name}`}
                  title="Unpin"
                >
                  ×
                </button>
              )}
            </span>
          );
        })}
        {unpinned.length > 0 && (
          <select
            className="event-stream-add"
            value=""
            aria-label="Pin another event stream"
            onChange={(e) => {
              const v = e.target.value;
              if (v) onPinStream(v);
            }}
          >
            <option value="">+ add stream</option>
            {unpinned.map((s) => (
              <option key={s.name} value={s.name}>{s.name}</option>
            ))}
          </select>
        )}
        <label className="event-coincidence-window">
          <span className="muted">±</span>
          <input
            type="number"
            step={0.01}
            min={0}
            value={coincidenceWindow}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (Number.isFinite(v)) onCoincidenceWindowChange(v);
            }}
            aria-label="Coincidence window (seconds)"
          />
          <span className="muted">s</span>
        </label>
      </div>

      {!streamMeta ? (
        <p className="muted">Pin a stream to view events.</p>
      ) : (
        <>
          <div className="panel-heading">
            <h2>Events — {streamMeta.name}</h2>
            <p>
              {streamMeta.n_events} total ·{" "}
              {streamMeta.time_range[0] != null && streamMeta.time_range[1] != null
                ? `${streamMeta.time_range[0].toFixed(2)}–${streamMeta.time_range[1].toFixed(2)}s`
                : ""}
              {" · "}
              <span className="review-counter" data-testid="review-counter">
                {counter.reviewed} of {counter.total} reviewed (window)
              </span>
            </p>
            {tensorName && (
              <ExportDecisionsControls
                tensorName={tensorName}
                streamName={streamMeta.name}
              />
            )}
          </div>

          <div className="event-nav">
            <button type="button" className="nav-btn" onClick={onPrev}>← Prev (k)</button>
            <span className="muted">t = {selectedTime.toFixed(3)}s</span>
            <button type="button" className="nav-btn" onClick={onNext}>Next (j) →</button>
          </div>

          <div className="event-scope" data-testid="event-scope" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className="muted">Scope:&nbsp;</span>
            <button
              type="button"
              className={eventChannelScope === "all" ? "pill active" : "pill"}
              onClick={() => setEventChannelScope("all")}
              title="List every event in the window, regardless of detecting channel"
            >
              All channels
            </button>
            <button
              type="button"
              className={eventChannelScope === "channel" ? "pill active" : "pill"}
              onClick={() => setEventChannelScope("channel")}
              title="Only events detected on the selected grid cell"
            >
              @ AP {scopeAp} · ML {scopeMl}
            </button>
          </div>

          {/* Inspect-at-full-resolution nav (additive). Steps through the
              sorted list, re-framing a tight (≤ 8 s) full-res window each step. */}
          {onInspectEvent && (
            <div className="event-inspect-nav" data-testid="event-inspect-nav">
              <button
                type="button"
                className="nav-btn"
                onClick={() => inspectStep(-1)}
                disabled={visibleEvents.length === 0}
                title="Inspect previous event at full resolution"
              >
                ‹ Inspect (,)
              </button>
              <button
                type="button"
                className="nav-btn"
                data-testid="inspect-current-btn"
                onClick={() => inspectByPosition(activePos < 0 ? 0 : activePos)}
                disabled={visibleEvents.length === 0}
                title="Inspect the selected event at full resolution (Enter)"
              >
                ⤢ Inspect (Enter)
              </button>
              <button
                type="button"
                className="nav-btn"
                onClick={() => inspectStep(1)}
                disabled={visibleEvents.length === 0}
                title="Inspect next event at full resolution"
              >
                Inspect (.) ›
              </button>
            </div>
          )}

          <div className="event-filter">
            <label htmlFor="event-status-filter" className="muted">Filter:&nbsp;</label>
            <select
              id="event-status-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value as StatusFilter)}
            >
              {(["all", "pending", "accepted", "rejected", "maybe"] as StatusFilter[]).map(
                (s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ),
              )}
            </select>
            <span className="muted shortcut-hint">y / n / m / u</span>
          </div>

          <details className="event-property-filter" style={{ margin: "4px 0" }}>
            <summary style={{ cursor: "pointer", fontSize: 12 }}>
              Property filters
            </summary>
            <div style={{ padding: "6px 2px 2px" }}>
              <EventFilterPanel
                streamName={streamMeta.name}
                records={rawEvents}
                filteredCount={events.length}
                columns={streamMeta.columns}
                excludeColumns={[streamMeta.time_col, streamMeta.id_col]}
              />
            </div>
          </details>

          {pinnedStreams.length >= 2 && (
            <p
              className="event-coincidence-summary muted"
              data-testid="coincidence-summary"
            >
              Coincidences (±{coincidenceWindow.toFixed(2)}s):{" "}
              <strong>{coincidenceCount}</strong> of {events.length} active-stream events
            </p>
          )}

          {visibleEvents.length === 0 ? (
            <div className="muted event-empty" data-testid="event-empty">
              {events.length === 0 ? (
                <>
                  <p>
                    No {streamMeta.name} events within ±{EVENT_WINDOW_HALF_S} s of the
                    cursor
                    {eventChannelScope === "channel"
                      ? ` on cell AP ${scopeAp} · ML ${scopeMl}`
                      : ""}
                    .
                  </p>
                  <p>
                    The stream has {streamMeta.n_events} events over{" "}
                    {(streamMeta.time_range[0] ?? 0).toFixed(0)}–{(streamMeta.time_range[1] ?? 0).toFixed(0)} s
                    — use Next (j) / Prev (k) to jump to one
                    {eventChannelScope === "channel"
                      ? ", or switch the scope to All channels"
                      : ""}
                    .
                  </p>
                </>
              ) : (
                <p>{`No ${filter} events in current window.`}</p>
              )}
            </div>
          ) : (
            <div className="event-table-wrap">
              <table className="event-table">
                <thead>
                  <tr>
                    <th aria-label="Review status" />
                    {cols.map((col) => {
                      const isSorted = sort.column === col;
                      const arrow = isSorted
                        ? sort.direction === "asc"
                          ? " ▲"
                          : " ▼"
                        : "";
                      return (
                        <th
                          key={col}
                          className={`sortable-col${isSorted ? " sorted" : ""}`}
                          data-testid={`event-col-${col}`}
                          aria-sort={
                            isSorted
                              ? sort.direction === "asc"
                                ? "ascending"
                                : "descending"
                              : "none"
                          }
                          onClick={() => setSort((s) => nextSortState(s, col))}
                          style={{ cursor: "pointer", userSelect: "none" }}
                          title="Click to sort"
                        >
                          {col}
                          {arrow}
                        </th>
                      );
                    })}
                    <th>notes</th>
                    {onInspectEvent && <th aria-label="Inspect" />}
                  </tr>
                </thead>
                <tbody>
                  {visibleEvents.map(({ ev, idx }) => {
                    const record = ev.record as Record<string, unknown>;
                    const t = toNumber(record.t ?? record[streamMeta.time_col]);
                    const eventId = record[streamMeta.id_col];
                    const status =
                      eventId != null ? idToStatus.get(eventId as string | number) : undefined;
                    const isCoincident = activeCoincidentIdx.has(idx);
                    const dk =
                      tensorName && eventId != null
                        ? decisionKey(
                            tensorName,
                            streamMeta.name,
                            eventId as string | number,
                          )
                        : null;
                    const decision = dk ? decisions[dk] : undefined;
                    const notesText = decision?.notes ?? "";
                    const tagsList = decision?.tags ?? [];
                    const notesPreview = previewNotes(notesText);
                    const popoverOpen =
                      eventId != null && eventId === popoverEventId;

                    const isActive = selectedEventId != null
                      ? eventId === selectedEventId
                      : t !== null && Math.abs(t - selectedTime) < 0.05;

                    return (
                      <Fragment key={idx}>
                        <tr
                          className={[
                            "event-row",
                            isActive ? "active" : "",
                            status ? `status-${status}` : "",
                            isCoincident ? "coincident" : "",
                            popoverOpen ? "annotation-open" : "",
                          ].filter(Boolean).join(" ")}
                          onClick={() => {
                            if (t === null) return;
                            const id = eventId as string | number;
                            onSelectEvent?.(id, streamMeta.name, t);
                            onSelectTime(t);
                          }}
                        >
                          <td className="status-cell" aria-label={status ?? "pending"}>
                            <button
                              type="button"
                              className="status-badge-btn"
                              aria-label={`Edit annotation (status: ${status ?? "pending"})`}
                              aria-haspopup="dialog"
                              aria-expanded={popoverOpen}
                              data-testid={`status-badge-${idx}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (eventId == null) return;
                                setPopoverEventId(
                                  popoverOpen
                                    ? null
                                    : (eventId as string | number),
                                );
                              }}
                            >
                              {isCoincident ? "⊕ " : ""}
                              {status ? STATUS_GLYPH[status] : "·"}
                            </button>
                          </td>
                          {cols.map((col) => (
                            <td key={col}>
                              {typeof record[col] === "number"
                                ? (record[col] as number).toFixed(3)
                                : String(record[col] ?? "")}
                            </td>
                          ))}
                          <td
                            className="notes-cell muted"
                            title={notesText || undefined}
                            data-testid={`notes-preview-${idx}`}
                          >
                            {notesPreview}
                          </td>
                          {onInspectEvent && (
                            <td className="inspect-cell">
                              <button
                                type="button"
                                className="inspect-row-btn"
                                data-testid={`inspect-btn-${idx}`}
                                aria-label="Inspect at full resolution"
                                title="Inspect at full resolution"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (t === null || eventId == null) return;
                                  const span = eventTimeRange(record, streamMeta.time_col);
                                  const useSpan = span && span[1] > span[0] ? span : null;
                                  onInspectEvent(
                                    eventId as string | number,
                                    streamMeta.name,
                                    t,
                                    useSpan,
                                  );
                                }}
                              >
                                ⤢
                              </button>
                            </td>
                          )}
                        </tr>
                        {popoverOpen && eventId != null && (
                          <tr
                            className="annotation-popover-row"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <td colSpan={cols.length + 2 + (onInspectEvent ? 1 : 0)}>
                              <AnnotationPopover
                                initial={{
                                  status: status ?? "pending",
                                  notes: notesText,
                                  tags: tagsList,
                                }}
                                onCommit={(next) =>
                                  commitAnnotation(eventId as string | number, next)
                                }
                                onCancel={() => setPopoverEventId(null)}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
