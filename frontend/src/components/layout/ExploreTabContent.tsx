/**
 * ExploreTabContent — the default sidebar tab content.
 *
 * Contains all the controls that were previously in NavRail:
 *   - SelectionPanel (time, spatial, freq controls)
 *   - LayoutPanel (preset picker)
 *   - ProcessingPanel (transform params)
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useProcessingQuery, useSetProcessing } from "../../api/queries";
import type { LayoutDTO, SelectionDTO } from "../../api/types";
import { useAppStore } from "../../store/appStore";
import { useSelectionStore, toSelectionDTO } from "../../store/selectionStore";
import { LayoutPanel } from "../controls/LayoutPanel";
import { ProcessingPanel } from "../controls/ProcessingPanel";
import { SelectionPanel } from "../controls/SelectionPanel";

type ExploreTabContentProps = {
  /** Called when the user commits a selection change via the Apply button. */
  onCommitSelection: (dto: SelectionDTO) => void;
};

export function ExploreTabContent({ onCommitSelection }: ExploreTabContentProps) {
  const queryClient = useQueryClient();
  const { layoutDraft, setLayoutDraft } = useAppStore();
  const selectionState = useSelectionStore();
  const { patchFromDTO } = selectionState;
  const selectionDraft = toSelectionDTO(selectionState);

  const processingQuery = useProcessingQuery();
  const setProcessingMutation = useSetProcessing();

  const layoutMutation = useMutation({
    mutationFn: (payload: { preset: string }) => api.updateLayout(payload),
    onSuccess: (layout) => {
      setLayoutDraft(layout as LayoutDTO);
      queryClient.invalidateQueries({ queryKey: ["state"] });
    },
  });

  if (!layoutDraft) return null;

  return (
    <>
      <SelectionPanel
        selection={selectionDraft}
        onSelectionChange={patchFromDTO}
        onCommit={() => onCommitSelection(selectionDraft)}
      />
      <LayoutPanel
        layout={layoutDraft}
        onPresetChange={(preset) => layoutMutation.mutate({ preset })}
      />
      {processingQuery.data && (
        <ProcessingPanel
          params={processingQuery.data}
          onApply={(p) => setProcessingMutation.mutate(p)}
          isPending={setProcessingMutation.isPending}
        />
      )}
    </>
  );
}
