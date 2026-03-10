import type { EventStreamMetaDTO } from "../../api/types";

type EventSummaryProps = {
  events: EventStreamMetaDTO[];
};

export function EventSummary({ events }: EventSummaryProps) {
  return (
    <section className="panel-card secondary">
      <div className="panel-heading">
        <h2>Events</h2>
        <p>Loaded from `/api/v1/events`.</p>
      </div>
      <div className="coord-table">
        {events.map((event) => (
          <article className="coord-card" key={event.name}>
            <strong>{event.name}</strong>
            <span>{event.n_events} rows</span>
            <span>
              {String(event.time_range[0])} to {String(event.time_range[1])}
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}
