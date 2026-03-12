/**
 * SpatialEventView — peri-event spatial heatmap.
 *
 * When an event is selected (event.eventId !== null), fetches and displays
 * the spatial activity centered at the event's time (driven by timeCursor).
 * Shows a placeholder when no event is selected or data is loading.
 */
import { useSelectionStore, toSelectionDTO } from "../../store/selectionStore";
import { useSliceQuery, makeDefaultSliceRequest } from "../../api/queries";
import { SpatialMapSliceView } from "./SpatialMapSliceView";

type SpatialEventViewProps = {
  tensorName: string | null;
  /** Peri-event half-window in seconds (default 0.05s = 50ms). */
  periEventWindow?: number;
};

export function SpatialEventView({
  tensorName,
  periEventWindow = 0.05,
}: SpatialEventViewProps) {
  const selectionState = useSelectionStore();
  const { timeCursor, event } = selectionState;
  const selectionDTO = toSelectionDTO(selectionState);

  const hasEvent = event.eventId !== null;

  const request =
    tensorName && hasEvent
      ? makeDefaultSliceRequest("spatial_map", selectionDTO, [
          timeCursor - periEventWindow,
          timeCursor + periEventWindow,
        ])
      : null;

  const sliceQuery = useSliceQuery(tensorName, request);

  if (!tensorName || !hasEvent) {
    return (
      <div className="placeholder">Select an event to view spatial activity</div>
    );
  }

  if (sliceQuery.isLoading) {
    return <div className="placeholder">Loading…</div>;
  }

  return (
    <div className="spatial-event-panel">
      <div className="event-label">
        {event.streamName}: {String(event.eventId)}
      </div>
      {sliceQuery.data ? (
        <SpatialMapSliceView
          slice={sliceQuery.data}
          selection={selectionDTO}
        />
      ) : null}
    </div>
  );
}
