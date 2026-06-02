import { useEffect, useCallback, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api/client";
import { useEventWindowQueries, useStateQuery } from "./api/queries";
import { usePairingStream } from "./api/pairingStream";
import type { EventRecordDTO, SelectionDTO } from "./api/types";
import { coincidenceIndicesByStream, extractEventTimes } from "./api/coincidence";
import { WorkspaceMain } from "./components/views/WorkspaceMain";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LayoutShell } from "./components/layout/LayoutShell";
import { InspectorPanel } from "./components/layout/InspectorPanel";
import { SidebarTabBar } from "./components/layout/SidebarTabBar";
import { SidebarContent } from "./components/layout/SidebarContent";
import { ExploreTabContent } from "./components/layout/ExploreTabContent";
import { EventsTabContent } from "./components/layout/EventsTabContent";
import { SettingsDialog } from "./components/settings/SettingsDialog";
import { useEventNavigation } from "./components/views/useEventNavigation";
import { useEventReviewShortcuts } from "./components/views/useEventReviewShortcuts";
import { useGestureShortcuts } from "./components/views/useGestureShortcuts";
import { buildStreamColorMap } from "./components/views/eventStreamColors";
import { useAppStore } from "./store/appStore";
import { useEventStreamsStore } from "./store/eventStreamsStore";
import { useSelectionStore, toSelectionDTO } from "./store/selectionStore";

function App() {
  const queryClient = useQueryClient();
  const stateQuery = useStateQuery();
  usePairingStream(queryClient);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [navigatorElement, setNavigatorElement] = useState<ReactNode>(null);

  // Shell state
  const {
    selectedTensor,
    layoutDraft,
    theme,
    setSelectedTensor,
    setLayoutDraft,
    setTheme,
  } = useAppStore();

  // Navigation state
  const selectionState = useSelectionStore();
  const { initFromDTO, patchFromDTO } = selectionState;
  const selectionDraft: SelectionDTO = toSelectionDTO(selectionState);
  const initialized = selectionState.hasInitialized;

  // Event-centric navigation — updates selectionStore.event on row/marker click
  const eventNav = useEventNavigation();

  // Bootstrap stores from the first API response
  useEffect(() => {
    if (!stateQuery.data) return;
    if (!selectedTensor) setSelectedTensor(stateQuery.data.active_tensor);
    if (!layoutDraft) setLayoutDraft(stateQuery.data.layout);
    if (!initialized) initFromDTO(stateQuery.data.selection);
  }, [layoutDraft, selectedTensor, initialized, setLayoutDraft, setSelectedTensor, initFromDTO, stateQuery.data]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Selection mutation — the single server round-trip for navigation commits.
  // We do NOT invalidate ["slice"] here: every slice request carries
  // `selection` in its body, so changing the cursor naturally changes
  // each query's key and TanStack auto-fetches the new key. Adding an
  // explicit invalidate forces a *duplicate* fetch of the just-arrived
  // data — and refetches navigator (full-session) every click, which on
  // a long iEEG session is the dominant 5+ s lag the user reported.
  const selectionMutation = useMutation({
    mutationFn: (payload: SelectionDTO) => api.updateSelection(payload),
    onSuccess: (selection) => {
      // The cursor was already moved optimistically in commitSelection.
      // Reconcile to the server's canonical selection but PRESERVE the user's
      // current window (pass it explicitly) — a late response must not re-center
      // and stomp a pan the user made while the PUT was in flight. See
      // docs/design/time-transport.md (Phase C).
      initFromDTO(selection, useSelectionStore.getState().timeWindow);
      queryClient.invalidateQueries({ queryKey: ["state"] });
    },
  });

  const commitSelection = (payload: SelectionDTO) => {
    // Optimistic: move the cursor (and re-center the window if it left the
    // visible range) locally NOW, so the crosshair tracks the click without
    // waiting a full server round-trip. The PUT persists + reconciles.
    patchFromDTO(payload);
    selectionMutation.mutate(payload);
  };

  // Multi-stream event panel state (G5). The first detected stream is
  // auto-pinned on first load; everything else (pin more, switch active
  // stream, tweak coincidence window) is user-driven.
  const eventStreams = stateQuery.data?.events ?? [];
  const firstEventStream = eventStreams[0] ?? null;
  const {
    pinnedStreams,
    activeStreamName,
    coincidenceWindow,
    pinStream,
    unpinStream,
    setActiveStream,
    setCoincidenceWindow,
    ensureActive,
  } = useEventStreamsStore();

  useEffect(() => {
    ensureActive(firstEventStream?.name ?? null);
  }, [firstEventStream?.name, ensureActive]);

  // Drop pins whose stream is no longer advertised by the server (e.g.
  // detector ran with a different name). Otherwise we'd fire `useQueries`
  // against dead names forever.
  useEffect(() => {
    if (!stateQuery.data) return;
    const known = new Set(eventStreams.map((s) => s.name));
    for (const name of pinnedStreams) {
      if (!known.has(name)) unpinStream(name);
    }
  }, [eventStreams, pinnedStreams, unpinStream, stateQuery.data]);

  // Parallel window fetch for every pinned stream. Shared query keys mean
  // WorkspaceMain's parallel call hits the same cache entries (React Query
  // dedupes by ["events-window", name, selection, halfWindow]).
  const eventsByStream = useEventWindowQueries(pinnedStreams, selectionDraft, 2);

  const streamColors = useMemo(() => buildStreamColorMap(pinnedStreams), [pinnedStreams]);

  // Union of event times that have a coincident counterpart in any other
  // pinned stream — fed to the timeseries view for the ringed glyph.
  const coincidentTimes = useMemo<number[]>(() => {
    if (pinnedStreams.length < 2) return [];
    const byStream = new Map<string, ReturnType<typeof extractEventTimes>>();
    for (const name of pinnedStreams) {
      const recs = eventsByStream.get(name);
      const meta = eventStreams.find((s) => s.name === name) ?? null;
      if (!recs) continue;
      byStream.set(name, extractEventTimes(recs, meta));
    }
    const idx = coincidenceIndicesByStream(byStream, coincidenceWindow);
    const times: number[] = [];
    for (const [name, set] of idx) {
      const evs = byStream.get(name);
      if (!evs) continue;
      for (const i of set) times.push(evs[i].t);
    }
    return times;
  }, [pinnedStreams, eventsByStream, eventStreams, coincidenceWindow]);

  // Prev/next navigation jumps to the nearest event in the ACTIVE stream
  // and updates the event identity.
  const goToEvent = useCallback(
    (direction: "prev" | "next") => {
      if (!activeStreamName) return;
      const meta = eventStreams.find((s) => s.name === activeStreamName);
      if (!meta) return;
      const params = new URLSearchParams({
        t0: direction === "prev" ? "0" : String(selectionState.timeCursor + 0.001),
        t1: direction === "prev"
          ? String(Math.max(0, selectionState.timeCursor - 0.001))
          : String(meta.time_range[1] ?? selectionState.timeCursor + 100),
      });
      api.getEventWindow(activeStreamName, params).then((evs: EventRecordDTO[]) => {
        const ev = direction === "prev" ? evs[evs.length - 1] : evs[0];
        if (!ev) return;
        const record = ev.record as Record<string, unknown>;
        const t = Number(record.t ?? NaN);
        if (!Number.isFinite(t)) return;
        const eventId = record[meta.id_col] as string | number | undefined;
        if (eventId != null) eventNav.selectEvent(eventId, activeStreamName);
        commitSelection({ ...selectionDraft, time: t });
      });
    },
    [activeStreamName, eventStreams, selectionState.timeCursor, selectionDraft, eventNav], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Global keyboard shortcuts for event review (j/k prev/next, y/n/m/u
  // accept/reject/maybe/clear). Bails when focus is in an input. See
  // `docs/design/event-review.md`.
  useEventReviewShortcuts({
    tensorName: selectedTensor,
    streamName: activeStreamName,
    currentEventId: eventNav.selectedEventId,
    goPrev: () => goToEvent("prev"),
    goNext: () => goToEvent("next"),
  });

  // Bokeh-style gesture shortcuts: p/b/s switch the active drag tool,
  // w toggles wheel-zoom, c toggles the crosshair inspector.
  useGestureShortcuts();

  if (stateQuery.isLoading || !stateQuery.data || !layoutDraft) {
    return <div className="empty-state">Connecting to TensorScope API…</div>;
  }
  if (stateQuery.isError) {
    return <div className="empty-state error">Failed to load API state.</div>;
  }

  return (
    <LayoutShell
      title={stateQuery.data.layout.title}
      sessionId={stateQuery.data.session_id}
      layout={layoutDraft}
      toolbar={(
        <button
          aria-label="Open settings"
          className="icon-button"
          onClick={() => setSettingsOpen(true)}
          type="button"
        >
          <span aria-hidden="true">⚙</span>
        </button>
      )}
      nav={
        <>
          <SidebarTabBar />
          <SidebarContent
            exploreContent={
              <ExploreTabContent onCommitSelection={commitSelection} />
            }
            eventsContent={
              <EventsTabContent
                tensorName={selectedTensor}
                streams={eventStreams}
                pinnedStreams={pinnedStreams}
                activeStreamName={activeStreamName}
                streamColors={streamColors}
                eventsByStream={eventsByStream}
                coincidenceWindow={coincidenceWindow}
                selectedTime={selectionState.timeCursor}
                selectedEventId={eventNav.selectedEventId}
                onSelectTime={(t) => commitSelection({ ...selectionDraft, time: t })}
                onSelectEvent={(eventId, streamName) => eventNav.selectEvent(eventId, streamName)}
                onPrev={() => goToEvent("prev")}
                onNext={() => goToEvent("next")}
                onActivateStream={setActiveStream}
                onPinStream={pinStream}
                onUnpinStream={unpinStream}
                onCoincidenceWindowChange={setCoincidenceWindow}
              />
            }
          />
        </>
      }
      inspector={
        <InspectorPanel
          tensorSummary={
            stateQuery.data?.tensors.find((t) => t.name === selectedTensor) ?? null
          }
        />
      }
      bottomPanel={navigatorElement}
    >
      <ErrorBoundary label="WorkspaceMain">
        <WorkspaceMain
          onCommitSelection={commitSelection}
          renderNavigator={setNavigatorElement}
        />
      </ErrorBoundary>
      <SettingsDialog
        open={settingsOpen}
        theme={theme}
        onClose={() => setSettingsOpen(false)}
        onThemeChange={setTheme}
      />
    </LayoutShell>
  );
}

export default App;
