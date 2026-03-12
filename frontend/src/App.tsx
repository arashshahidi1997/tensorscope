import { useEffect, useCallback, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api/client";
import { useEventWindowQuery, useStateQuery } from "./api/queries";
import type { EventRecordDTO, SelectionDTO } from "./api/types";
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
import { useAppStore } from "./store/appStore";
import { useSelectionStore, toSelectionDTO } from "./store/selectionStore";

function App() {
  const queryClient = useQueryClient();
  const stateQuery = useStateQuery();
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
  const { initFromDTO } = selectionState;
  const selectionDraft: SelectionDTO = toSelectionDTO(selectionState);
  const initialized = selectionState.timeCursor !== 0 || selectionState.spatial.ap !== 0;

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

  // Selection mutation — the single server round-trip for navigation commits
  const selectionMutation = useMutation({
    mutationFn: (payload: SelectionDTO) => api.updateSelection(payload),
    onSuccess: (selection) => {
      initFromDTO(selection);
      queryClient.invalidateQueries({ queryKey: ["state"] });
      queryClient.invalidateQueries({ queryKey: ["slice"] });
    },
  });

  const commitSelection = (payload: SelectionDTO) => selectionMutation.mutate(payload);

  // Event inspector data (also fetched by WorkspaceMain for timeseries markers;
  // React Query deduplicates the request via the shared query key)
  const firstEventStream = stateQuery.data?.events[0] ?? null;
  const eventWindowQuery = useEventWindowQuery(firstEventStream?.name ?? null, selectionDraft, 2);

  // Prev/next navigation jumps to the nearest event and updates event identity
  const goToEvent = useCallback(
    (direction: "prev" | "next") => {
      if (!firstEventStream?.name) return;
      const params = new URLSearchParams({
        t0: direction === "prev" ? "0" : String(selectionState.timeCursor + 0.001),
        t1: direction === "prev"
          ? String(Math.max(0, selectionState.timeCursor - 0.001))
          : String(firstEventStream.time_range[1] ?? selectionState.timeCursor + 100),
      });
      api.getEventWindow(firstEventStream.name, params).then((evs: EventRecordDTO[]) => {
        const ev = direction === "prev" ? evs[evs.length - 1] : evs[0];
        if (!ev) return;
        const record = ev.record as Record<string, unknown>;
        const t = Number(record.t ?? NaN);
        if (!Number.isFinite(t)) return;
        // Update event identity in the store before the server commit
        const eventId = record[firstEventStream.id_col] as string | number | undefined;
        if (eventId != null) eventNav.selectEvent(eventId, firstEventStream.name);
        commitSelection({ ...selectionDraft, time: t });
      });
    },
    [firstEventStream, selectionState.timeCursor, selectionDraft, eventNav], // eslint-disable-line react-hooks/exhaustive-deps
  );

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
                streamMeta={firstEventStream}
                events={eventWindowQuery.data ?? []}
                selectedTime={selectionState.timeCursor}
                selectedEventId={eventNav.selectedEventId}
                onSelectTime={(t) => commitSelection({ ...selectionDraft, time: t })}
                onSelectEvent={(eventId, streamName) => eventNav.selectEvent(eventId, streamName)}
                onPrev={() => goToEvent("prev")}
                onNext={() => goToEvent("next")}
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
