import { useEffect, useCallback, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api/client";
import { EVENT_WINDOW_HALF_S, useEventWindowQueries, useStateQuery, useTensorQuery } from "./api/queries";
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
import { inspectWindowFor } from "./components/views/inspectWindow";
import { useEventReviewShortcuts } from "./components/views/useEventReviewShortcuts";
import { useTimeCursorShortcuts } from "./components/views/useTimeCursorShortcuts";
import { useGestureShortcuts } from "./components/views/useGestureShortcuts";
import { buildStreamColorMap } from "./components/views/eventStreamColors";
import { useAppStore } from "./store/appStore";
import { useEventStreamsStore } from "./store/eventStreamsStore";
import { useEventFilterStore } from "./store/eventFilterStore";
import { applyEventFilters } from "./components/views/eventFilterLogic";
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

  // Active tensor metadata — used to derive the smallest time unit (sample
  // period) for arrow-key cursor nudging.
  const tensorMeta = useTensorQuery(selectedTensor);
  const { timeStep, timeBounds } = useMemo(() => {
    const tc = tensorMeta.data?.coords.find((c) => c.name === "time");
    const lo = tc ? Number(tc.min) : NaN;
    const hi = tc ? Number(tc.max) : NaN;
    const n = tc?.length ?? 0;
    const step =
      n > 1 && Number.isFinite(lo) && Number.isFinite(hi)
        ? (hi - lo) / (n - 1)
        : null;
    return {
      timeStep: step,
      timeBounds: [
        Number.isFinite(lo) ? lo : null,
        Number.isFinite(hi) ? hi : null,
      ] as [number | null, number | null],
    };
  }, [tensorMeta.data]);

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
      const st = useSelectionStore.getState();
      const liveFreq = st.freq;
      initFromDTO(selection, st.timeWindow);
      // `freq` is a client-local projection — handleSelectFreq never round-trips
      // it (the spectrogram/PSD render the full freq range and place the cursor
      // client-side). A click commits time (server) AND freq (local) in one go;
      // without re-applying the live freq here, the time-commit's echo (carrying
      // the pre-click freq) reverts it — so a single click's freq "didn't stick"
      // until a second click. Preserve it like timeWindow / event.
      useSelectionStore.getState().setFreq(liveFreq);
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
  // dedupes by ["events-window", name, selection, halfWindow, scope]).
  const eventChannelScope = useAppStore((s) => s.eventChannelScope);
  const eventsByStream = useEventWindowQueries(
    pinnedStreams,
    selectionDraft,
    EVENT_WINDOW_HALF_S,
    eventChannelScope,
  );
  // E1: apply the per-stream property filters once. The table, coincidence,
  // and counts all read the surviving population; the raw map stays available
  // for the filter UI's distribution histograms (E2).
  const eventFilters = useEventFilterStore((s) => s.filters);
  const filteredEventsByStream = useMemo(
    () => applyEventFilters(eventsByStream, eventFilters),
    [eventsByStream, eventFilters],
  );

  const streamColors = useMemo(() => buildStreamColorMap(pinnedStreams), [pinnedStreams]);

  // Union of event times that have a coincident counterpart in any other
  // pinned stream — fed to the timeseries view for the ringed glyph.
  const coincidentTimes = useMemo<number[]>(() => {
    if (pinnedStreams.length < 2) return [];
    const byStream = new Map<string, ReturnType<typeof extractEventTimes>>();
    for (const name of pinnedStreams) {
      const recs = filteredEventsByStream.get(name);
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
  }, [pinnedStreams, filteredEventsByStream, eventStreams, coincidenceWindow]);

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
      // Honor the channel scope: "all" (default) jumps across every channel's
      // events; "channel" restricts to the selected cell, like the table.
      if (eventChannelScope === "channel") {
        params.set("ap", String(selectionDraft.ap ?? 0));
        params.set("ml", String(selectionDraft.ml ?? 0));
      }
      api.getEventWindow(activeStreamName, params).then((evs: EventRecordDTO[]) => {
        const ev = direction === "prev" ? evs[evs.length - 1] : evs[0];
        if (!ev) return;
        const record = ev.record as Record<string, unknown>;
        // Manifest streams key time by their declared time_col (e.g. t_peak);
        // only the demo fixtures use a literal `t` — same fallback the table
        // rows use, without which j/k silently no-ops on real streams.
        const t = Number(record.t ?? record[meta.time_col] ?? NaN);
        if (!Number.isFinite(t)) return;
        const eventId = record[meta.id_col] as string | number | undefined;
        if (eventId != null) eventNav.selectEvent(eventId, activeStreamName);
        // Center the visible window on the event so the timeseries scrolls to
        // bring it into view. Without this, navigating to an event already
        // inside the current window only moves the cursor — the window (and the
        // timeseries data) stays put (selectionStore.patchFromDTO re-centers
        // ONLY when the cursor leaves the window). Event review expects each
        // event centered.
        selectionState.recenterWindowOn(t);
        commitSelection({ ...selectionDraft, time: t });
      });
    },
    [activeStreamName, eventStreams, selectionState.timeCursor, selectionDraft, eventNav, eventChannelScope], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Inspect-event action (additive): re-frame the timeseries to a TIGHT window
  // around the event and switch the timeseries fetch to full resolution
  // (downsample:"none") so fast oscillations (ripples/spindles) show individual
  // cycles. The window is clamped to ≤ MAX_INSPECT_WIDTH_S so the un-decimated
  // fetch can't trip the server's 60 k-sample cap. Distinct from a plain row
  // click (which only moves the cursor / window): inspect ALSO flips the store's
  // `inspectMode` so `useWorkspaceData` swaps in the full-res request.
  const inspectEvent = useCallback(
    (
      eventId: string | number,
      streamName: string,
      t: number,
      span?: [number, number] | null,
    ) => {
      if (!Number.isFinite(t)) return;
      const win = inspectWindowFor(t, span ?? null);
      eventNav.selectEvent(eventId, streamName);
      const st = useSelectionStore.getState();
      st.setInspectMode(true);
      st.setTimeWindow(win);
      st.setTimeCursor(t);
      commitSelection({ ...selectionDraft, time: t });
    },
    [eventNav, selectionDraft], // eslint-disable-line react-hooks/exhaustive-deps
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

  // Arrow keys nudge the time cursor by one sample period (the smallest unit);
  // Shift+arrows step by 5× the sample period. Local-only (no server commit):
  // matches the movie/animation cursor drivers — the cursor-windowed views
  // refetch off the live store cursor anyway, and a per-keypress PUT + state
  // refetch would be pure overhead during held-down stepping.
  const nudgeCursor = useCallback(
    (t: number) => useSelectionStore.getState().setTimeCursor(t),
    [],
  );
  useTimeCursorShortcuts({
    step: timeStep,
    bounds: timeBounds,
    commit: nudgeCursor,
  });

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
                eventsByStream={filteredEventsByStream}
                rawEventsByStream={eventsByStream}
                coincidenceWindow={coincidenceWindow}
                selectedTime={selectionState.timeCursor}
                selectedEventId={eventNav.selectedEventId}
                onSelectTime={(t) => commitSelection({ ...selectionDraft, time: t })}
                onSelectEvent={(eventId, streamName) => {
                  // A plain row click is normal navigation: leave inspect mode
                  // (so the timeseries returns to the decimated LOD path).
                  useSelectionStore.getState().setInspectMode(false);
                  eventNav.selectEvent(eventId, streamName);
                }}
                onInspectEvent={inspectEvent}
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
