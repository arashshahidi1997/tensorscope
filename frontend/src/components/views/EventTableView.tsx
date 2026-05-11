import { useMemo, useState } from "react";
import type { EventRecordDTO, EventStreamMetaDTO } from "../../api/types";
import { toNumber } from "../../api/arrow";
import {
  countReviewedInScope,
  decisionKey,
  useEventReviewStore,
  type EventReviewStatus,
} from "../../store/eventReviewStore";

type StatusFilter = "all" | "pending" | "accepted" | "rejected" | "maybe";

type Props = {
  /** Active tensor — needed to scope decisions per dataset. */
  tensorName: string | null;
  streamMeta: EventStreamMetaDTO | null;
  events: EventRecordDTO[];
  selectedTime: number;
  /** Identity of the currently active event row (from selectionStore.event.eventId). */
  selectedEventId?: string | number | null;
  onSelectTime: (t: number) => void;
  /**
   * Called when the user clicks an event row.
   * The caller should update selectionStore.event AND commit the time cursor.
   */
  onSelectEvent?: (eventId: string | number, streamName: string, t: number) => void;
  onPrev: () => void;
  onNext: () => void;
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
  streamMeta,
  events,
  selectedTime,
  selectedEventId,
  onSelectTime,
  onSelectEvent,
  onPrev,
  onNext,
}: Props) {
  const [filter, setFilter] = useState<StatusFilter>("all");
  // Subscribe directly to decisions so badge updates re-render. Reading
  // via `getState()` would not subscribe and the badges would freeze
  // until the parent re-rendered for another reason.
  const decisions = useEventReviewStore((s) => s.decisions);

  // Map event IDs → status for the visible window. Computed once per
  // render; the decisions map is small (< total events).
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

  // Counter: how many of the *currently-visible* events have decisions.
  // The full-dataset counter (e.g. "42 of 312 reviewed") needs the
  // global event ID list which isn't loaded in the window query — track
  // window-scoped here, dataset-scoped via a separate query later.
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

  if (!streamMeta) {
    return (
      <div className="control-stack">
        <div className="panel-heading"><h2>Events</h2><p>No event streams loaded.</p></div>
      </div>
    );
  }

  const cols = streamMeta.columns.slice(0, 6);

  // Filter events by review status. "pending" = no decision recorded.
  const visibleEvents = events.filter((ev) => {
    if (filter === "all") return true;
    const id = (ev.record as Record<string, unknown>)[streamMeta.id_col] as
      | string
      | number
      | undefined;
    const status = id != null ? idToStatus.get(id) : undefined;
    if (filter === "pending") return status === undefined;
    return status === filter;
  });

  return (
    <div className="control-stack">
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
      </div>

      <div className="event-nav">
        <button type="button" className="nav-btn" onClick={onPrev}>← Prev (k)</button>
        <span className="muted">t = {selectedTime.toFixed(3)}s</span>
        <button type="button" className="nav-btn" onClick={onNext}>Next (j) →</button>
      </div>

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

      {visibleEvents.length === 0 ? (
        <p className="muted">
          {events.length === 0
            ? "No events in current window."
            : `No ${filter} events in current window.`}
        </p>
      ) : (
        <div className="event-table-wrap">
          <table className="event-table">
            <thead>
              <tr>
                <th aria-label="Review status" />
                {cols.map((col) => <th key={col}>{col}</th>)}
              </tr>
            </thead>
            <tbody>
              {visibleEvents.map((ev, idx) => {
                const record = ev.record as Record<string, unknown>;
                const t = toNumber(record.t ?? record[streamMeta.time_col]);
                const eventId = record[streamMeta.id_col];
                const status =
                  eventId != null ? idToStatus.get(eventId as string | number) : undefined;

                // Prefer explicit event identity match; fall back to time proximity
                // so the row still highlights when navigating via prev/next before
                // the event ID is captured in the store.
                const isActive = selectedEventId != null
                  ? eventId === selectedEventId
                  : t !== null && Math.abs(t - selectedTime) < 0.05;

                return (
                  <tr
                    key={idx}
                    className={[
                      "event-row",
                      isActive ? "active" : "",
                      status ? `status-${status}` : "",
                    ].filter(Boolean).join(" ")}
                    onClick={() => {
                      if (t === null) return;
                      const id = eventId as string | number;
                      onSelectEvent?.(id, streamMeta.name, t);
                      onSelectTime(t);
                    }}
                  >
                    <td className="status-cell" aria-label={status ?? "pending"}>
                      {status ? STATUS_GLYPH[status] : ""}
                    </td>
                    {cols.map((col) => (
                      <td key={col}>
                        {typeof record[col] === "number"
                          ? (record[col] as number).toFixed(3)
                          : String(record[col] ?? "")}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
