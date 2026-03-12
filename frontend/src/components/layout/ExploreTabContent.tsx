/**
 * ExploreTabContent — the default sidebar tab content.
 *
 * Contains:
 *   - ProcessingPanel (transform params) — top, expanded by default
 *   - SelectionPanel (time, spatial, freq controls) — bottom, collapsed by default
 */
import { useBrainstateMetaQuery, useProcessingQuery, useSetProcessing } from "../../api/queries";
import type { SelectionDTO } from "../../api/types";
import { useAppStore } from "../../store/appStore";
import { useSelectionStore, toSelectionDTO } from "../../store/selectionStore";
import { CollapsibleSection } from "./CollapsibleSection";
import { ProcessingPanel } from "../controls/ProcessingPanel";
import { SelectionPanel } from "../controls/SelectionPanel";

type ExploreTabContentProps = {
  /** Called when the user commits a selection change via the Apply button. */
  onCommitSelection: (dto: SelectionDTO) => void;
};

export function ExploreTabContent({ onCommitSelection }: ExploreTabContentProps) {
  const selectionState = useSelectionStore();
  const { patchFromDTO } = selectionState;
  const selectionDraft = toSelectionDTO(selectionState);

  const processingQuery = useProcessingQuery();
  const setProcessingMutation = useSetProcessing();

  const brainstateMetaQuery = useBrainstateMetaQuery();
  const brainstateAvailable = brainstateMetaQuery.data?.available ?? false;
  const { brainstateOverlay, showHypnogram, toggleBrainstateOverlay, toggleHypnogram } = useAppStore();

  return (
    <>
      <CollapsibleSection title="Processing" defaultOpen={true}>
        {processingQuery.data && (
          <ProcessingPanel
            params={processingQuery.data}
            onApply={(p) => setProcessingMutation.mutate(p)}
            isPending={setProcessingMutation.isPending}
          />
        )}
      </CollapsibleSection>

      {brainstateAvailable && (
        <CollapsibleSection title="Brainstates" defaultOpen={true}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "4px 0" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={brainstateOverlay}
                onChange={toggleBrainstateOverlay}
              />
              Color overlay on traces
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={showHypnogram}
                onChange={toggleHypnogram}
              />
              Hypnogram strip
            </label>
            <div style={{ fontSize: 11, color: "#8b949e", marginTop: 2 }}>
              States: {brainstateMetaQuery.data?.state_names.join(", ")}
            </div>
          </div>
        </CollapsibleSection>
      )}

      <CollapsibleSection title="Selection" defaultOpen={false}>
        <SelectionPanel
          selection={selectionDraft}
          onSelectionChange={patchFromDTO}
          onCommit={() => onCommitSelection(selectionDraft)}
        />
      </CollapsibleSection>
    </>
  );
}
