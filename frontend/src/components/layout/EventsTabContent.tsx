/**
 * EventsTabContent — sidebar tab for event navigation.
 *
 * Contains the event table and prev/next navigation,
 * migrated from InspectorPanel.
 */
import { EventTableView } from "../views/EventTableView";
import type { EventRecordDTO, EventStreamMetaDTO } from "../../api/types";

type EventsTabContentProps = {
  /** Active tensor name — needed by the table to scope review decisions. */
  tensorName: string | null;
  streamMeta: EventStreamMetaDTO | null;
  events: EventRecordDTO[];
  selectedTime: number;
  selectedEventId: string | number | null;
  onSelectTime: (t: number) => void;
  onSelectEvent: (eventId: string | number, streamName: string) => void;
  onPrev: () => void;
  onNext: () => void;
};

export function EventsTabContent({
  tensorName,
  streamMeta,
  events,
  selectedTime,
  selectedEventId,
  onSelectTime,
  onSelectEvent,
  onPrev,
  onNext,
}: EventsTabContentProps) {
  return (
    <EventTableView
      tensorName={tensorName}
      streamMeta={streamMeta}
      events={events}
      selectedTime={selectedTime}
      selectedEventId={selectedEventId}
      onSelectTime={onSelectTime}
      onSelectEvent={onSelectEvent}
      onPrev={onPrev}
      onNext={onNext}
    />
  );
}
