import type { EventRecordDTO } from "../../api/types";

type EventOverlaySummaryProps = {
  events: EventRecordDTO[];
};

export function EventOverlaySummary({ events }: EventOverlaySummaryProps) {
  return (
    <div className="overlay-strip">
      <span className="meta-label">Events in window</span>
      <div className="overlay-pill-list">
        {events.length === 0 ? (
          <span className="overlay-pill muted">none</span>
        ) : (
          events.slice(0, 8).map((event, index) => (
            <span className="overlay-pill" key={index}>
              t={String(event.record.t ?? "?")}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
