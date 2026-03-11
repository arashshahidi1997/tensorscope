import { useSelectionStore } from "../../store/selectionStore";
import { EventTableView } from "../views/EventTableView";
import type { EventRecordDTO, EventStreamMetaDTO, TensorSummaryDTO } from "../../api/types";

type InspectorPanelProps = {
  /** Summary of the currently selected tensor, from StateDTO.tensors. */
  tensorSummary: TensorSummaryDTO | null;
  streamMeta: EventStreamMetaDTO | null;
  events: EventRecordDTO[];
  selectedEventId: string | number | null;
  onSelectTime: (t: number) => void;
  onSelectEvent: (eventId: string | number, streamName: string) => void;
  onPrev: () => void;
  onNext: () => void;
};

/**
 * Right-rail inspector panel.
 *
 * Shows three read-mostly sections:
 *   1. Tensor metadata — name, dims, shape, dtype
 *   2. Selection summary — cursor, window, freq, spatial
 *   3. Event table — prev/next navigation and row selection
 *
 * Navigation controls live in NavRail; this panel is context display only.
 */
export function InspectorPanel({
  tensorSummary,
  streamMeta,
  events,
  selectedEventId,
  onSelectTime,
  onSelectEvent,
  onPrev,
  onNext,
}: InspectorPanelProps) {
  const { timeCursor, timeWindow, freq, spatial } = useSelectionStore();

  return (
    <div className="inspector-panel">
      {tensorSummary && (
        <section className="inspector-section">
          <h3 className="inspector-heading">Tensor</h3>
          <dl className="inspector-dl">
            <dt>Name</dt>
            <dd title={tensorSummary.name}>{tensorSummary.name}</dd>
            <dt>Dims</dt>
            <dd>{tensorSummary.dims.join(" × ")}</dd>
            <dt>Shape</dt>
            <dd>{tensorSummary.shape.join(" × ")}</dd>
            <dt>Type</dt>
            <dd>{tensorSummary.dtype}</dd>
          </dl>
        </section>
      )}

      <section className="inspector-section">
        <h3 className="inspector-heading">Selection</h3>
        <dl className="inspector-dl">
          <dt>Time</dt>
          <dd>{timeCursor.toFixed(3)} s</dd>
          <dt>Window</dt>
          <dd>
            {timeWindow[0].toFixed(2)} – {timeWindow[1].toFixed(2)} s
          </dd>
          {freq.freq !== 0 && (
            <>
              <dt>Freq</dt>
              <dd>{freq.freq.toFixed(1)} Hz</dd>
            </>
          )}
          {spatial.ap !== 0 && (
            <>
              <dt>AP</dt>
              <dd>{spatial.ap}</dd>
            </>
          )}
          {spatial.ml !== 0 && (
            <>
              <dt>ML</dt>
              <dd>{spatial.ml}</dd>
            </>
          )}
          {spatial.channel !== null && (
            <>
              <dt>Ch</dt>
              <dd>{spatial.channel}</dd>
            </>
          )}
        </dl>
      </section>

      <EventTableView
        streamMeta={streamMeta}
        events={events}
        selectedTime={timeCursor}
        selectedEventId={selectedEventId}
        onSelectTime={onSelectTime}
        onSelectEvent={onSelectEvent}
        onPrev={onPrev}
        onNext={onNext}
      />
    </div>
  );
}
