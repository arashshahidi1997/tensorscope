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
  /** Every stream advertised by /api/v1/state. */
  streams: EventStreamMetaDTO[];
  pinnedStreams: string[];
  activeStreamName: string | null;
  streamColors: Map<string, string>;
  eventsByStream: Map<string, EventRecordDTO[]>;
  coincidenceWindow: number;
  selectedTime: number;
  selectedEventId: string | number | null;
  onSelectTime: (t: number) => void;
  onSelectEvent: (eventId: string | number, streamName: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onActivateStream: (name: string) => void;
  onPinStream: (name: string) => void;
  onUnpinStream: (name: string) => void;
  onCoincidenceWindowChange: (s: number) => void;
};

export function EventsTabContent({
  tensorName,
  streams,
  pinnedStreams,
  activeStreamName,
  streamColors,
  eventsByStream,
  coincidenceWindow,
  selectedTime,
  selectedEventId,
  onSelectTime,
  onSelectEvent,
  onPrev,
  onNext,
  onActivateStream,
  onPinStream,
  onUnpinStream,
  onCoincidenceWindowChange,
}: EventsTabContentProps) {
  return (
    <EventTableView
      tensorName={tensorName}
      streams={streams}
      pinnedStreams={pinnedStreams}
      activeStreamName={activeStreamName}
      streamColors={streamColors}
      eventsByStream={eventsByStream}
      coincidenceWindow={coincidenceWindow}
      selectedTime={selectedTime}
      selectedEventId={selectedEventId}
      onSelectTime={onSelectTime}
      onSelectEvent={onSelectEvent}
      onPrev={onPrev}
      onNext={onNext}
      onActivateStream={onActivateStream}
      onPinStream={onPinStream}
      onUnpinStream={onUnpinStream}
      onCoincidenceWindowChange={onCoincidenceWindowChange}
    />
  );
}
