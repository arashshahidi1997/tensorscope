import { useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api/client";
import { makeDefaultSliceRequest, useSliceQuery, useStateQuery, useTensorQuery } from "./api/queries";
import type { LayoutDTO, SelectionDTO } from "./api/types";
import { LayoutPanel } from "./components/controls/LayoutPanel";
import { SelectionPanel } from "./components/controls/SelectionPanel";
import { EventSummary } from "./components/views/EventSummary";
import { TensorChooser } from "./components/views/TensorChooser";
import { TensorOverview } from "./components/views/TensorOverview";
import { LayoutShell } from "./components/layout/LayoutShell";
import { useAppStore } from "./store/appStore";
import { viewRegistry } from "./registry/viewRegistry";

function App() {
  const queryClient = useQueryClient();
  const stateQuery = useStateQuery();
  const {
    selectedTensor,
    selectedView,
    selectionDraft,
    layoutDraft,
    setSelectedTensor,
    setSelectedView,
    setSelectionDraft,
    patchSelectionDraft,
    setLayoutDraft,
  } = useAppStore();

  useEffect(() => {
    if (!stateQuery.data) {
      return;
    }
    if (!selectedTensor) {
      setSelectedTensor(stateQuery.data.active_tensor);
    }
    if (!selectionDraft) {
      setSelectionDraft(stateQuery.data.selection);
    }
    if (!layoutDraft) {
      setLayoutDraft(stateQuery.data.layout);
    }
  }, [
    layoutDraft,
    selectedTensor,
    selectionDraft,
    setLayoutDraft,
    setSelectedTensor,
    setSelectionDraft,
    stateQuery.data,
  ]);

  const tensorQuery = useTensorQuery(selectedTensor);
  const effectiveView = selectedView ?? tensorQuery.data?.available_views[0] ?? "table";

  useEffect(() => {
    if (!selectedView && tensorQuery.data?.available_views.length) {
      setSelectedView(tensorQuery.data.available_views[0]);
    }
  }, [selectedView, setSelectedView, tensorQuery.data]);

  const sliceRequest =
    selectionDraft && selectedTensor ? makeDefaultSliceRequest(effectiveView, selectionDraft) : null;
  const sliceQuery = useSliceQuery(selectedTensor, sliceRequest);

  const selectionMutation = useMutation({
    mutationFn: (payload: SelectionDTO) => api.updateSelection(payload),
    onSuccess: (selection) => {
      setSelectionDraft(selection);
      queryClient.invalidateQueries({ queryKey: ["state"] });
      queryClient.invalidateQueries({ queryKey: ["slice"] });
    },
  });

  const layoutMutation = useMutation({
    mutationFn: (payload: { preset: string }) => api.updateLayout(payload),
    onSuccess: (layout) => {
      setLayoutDraft(layout as LayoutDTO);
      queryClient.invalidateQueries({ queryKey: ["state"] });
    },
  });

  if (stateQuery.isLoading || !stateQuery.data || !selectionDraft || !layoutDraft) {
    return <div className="empty-state">Connecting to TensorScope API…</div>;
  }

  if (stateQuery.isError) {
    return <div className="empty-state error">Failed to load API state.</div>;
  }

  const ViewComponent = viewRegistry[effectiveView] ?? viewRegistry.table;

  return (
    <LayoutShell
      title={stateQuery.data.layout.title}
      sessionId={stateQuery.data.session_id}
      layout={layoutDraft}
      sidebar={
        <>
          <SelectionPanel
            selection={selectionDraft}
            onSelectionChange={patchSelectionDraft}
            onCommit={() => selectionMutation.mutate(selectionDraft)}
          />
          <LayoutPanel
            layout={layoutDraft}
            onPresetChange={(preset) => layoutMutation.mutate({ preset })}
          />
        </>
      }
      details={<EventSummary events={stateQuery.data.events} />}
    >
      <div className="content-stack">
        <TensorChooser
          tensors={stateQuery.data.tensors}
          selectedTensor={selectedTensor ?? stateQuery.data.active_tensor}
          onSelectTensor={(name) => {
            setSelectedTensor(name);
            setSelectedView(null);
          }}
        />

        {tensorQuery.data ? (
          <TensorOverview
            tensor={tensorQuery.data}
            selectedView={effectiveView}
            onSelectView={setSelectedView}
          />
        ) : null}

        {sliceQuery.data ? <ViewComponent slice={sliceQuery.data} /> : null}
      </div>
    </LayoutShell>
  );
}

export default App;
