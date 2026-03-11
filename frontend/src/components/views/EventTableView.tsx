import type { EventRecordDTO, EventStreamMetaDTO } from "../../api/types";
import { toNumber } from "../../api/arrow";

type Props = {
  streamMeta: EventStreamMetaDTO | null;
  events: EventRecordDTO[];
  selectedTime: number;
  onSelectTime: (t: number) => void;
  onPrev: () => void;
  onNext: () => void;
};

export function EventTableView({
  streamMeta,
  events,
  selectedTime,
  onSelectTime,
  onPrev,
  onNext,
}: Props) {
  if (!streamMeta) {
    return (
      <div className="control-stack">
        <div className="panel-heading"><h2>Events</h2><p>No event streams loaded.</p></div>
      </div>
    );
  }

  const cols = streamMeta.columns.slice(0, 6); // cap displayed columns

  return (
    <div className="control-stack">
      <div className="panel-heading">
        <h2>Events — {streamMeta.name}</h2>
        <p>
          {streamMeta.n_events} total ·{" "}
          {streamMeta.time_range[0] != null && streamMeta.time_range[1] != null
            ? `${streamMeta.time_range[0].toFixed(2)}–${streamMeta.time_range[1].toFixed(2)}s`
            : ""}
        </p>
      </div>

      <div className="event-nav">
        <button type="button" className="nav-btn" onClick={onPrev}>← Prev</button>
        <span className="muted">t = {selectedTime.toFixed(3)}s</span>
        <button type="button" className="nav-btn" onClick={onNext}>Next →</button>
      </div>

      {events.length === 0 ? (
        <p className="muted">No events in current window.</p>
      ) : (
        <div className="event-table-wrap">
          <table className="event-table">
            <thead>
              <tr>
                {cols.map((col) => <th key={col}>{col}</th>)}
              </tr>
            </thead>
            <tbody>
              {events.map((ev, idx) => {
                const record = ev.record as Record<string, unknown>;
                const t = toNumber(record.t ?? record[streamMeta.time_col]);
                const isActive =
                  t !== null && Math.abs(t - selectedTime) < 0.05;
                return (
                  <tr
                    key={idx}
                    className={isActive ? "event-row active" : "event-row"}
                    onClick={() => { if (t !== null) onSelectTime(t); }}
                  >
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
