/**
 * useEventNavigation — reusable hook for event-centric navigation.
 *
 * Any view that needs to read or publish the active event identity should
 * use this hook rather than reading the selection store directly.
 *
 * Responsibilities:
 *   - expose which event is currently selected (eventId + streamName)
 *   - provide selectEvent() to update the shared event selection
 *
 * Not in scope:
 *   - server round-trips (those go through commitSelection in App.tsx)
 *   - time cursor (that is a separate field in SelectionState)
 *
 * Usage pattern for a view that makes events first-class navigation targets:
 *
 *   const eventNav = useEventNavigation();
 *
 *   // On row click / marker click:
 *   eventNav.selectEvent(eventId, streamName);
 *   onCommitTime(t);  // caller handles the server round-trip separately
 *
 *   // To highlight the active row:
 *   const isActive = eventNav.selectedEventId === myEventId;
 */
import { useCallback } from "react";
import { useSelectionStore } from "../../store/selectionStore";

export type EventNavigation = {
  /** Identity of the currently selected event, or null if none. */
  selectedEventId: string | number | null;
  /** Stream the selected event belongs to, or null if none. */
  selectedStreamName: string | null;
  /**
   * Update the shared event selection.
   * Store-local — does not trigger a server round-trip.
   * The caller is responsible for also committing the time cursor if needed.
   */
  selectEvent: (eventId: string | number, streamName: string) => void;
  /** Clear the active event selection. */
  clearEvent: () => void;
};

export function useEventNavigation(): EventNavigation {
  const { event, setEvent } = useSelectionStore();

  const selectEvent = useCallback(
    (eventId: string | number, streamName: string) => {
      setEvent({ eventId, streamName });
    },
    [setEvent],
  );

  const clearEvent = useCallback(() => {
    setEvent({ eventId: null, streamName: null });
  }, [setEvent]);

  return {
    selectedEventId: event.eventId,
    selectedStreamName: event.streamName,
    selectEvent,
    clearEvent,
  };
}
