/**
 * ExploreTabContent — the default sidebar tab content.
 *
 * Contains:
 *   - ProcessingPanel (transform params) — top, expanded by default
 *   - SelectionPanel (time, spatial, freq controls) — bottom, collapsed by default
 */
import { useMemo } from "react";
import { useProcessingQuery, useSetProcessing, useTensorQuery, useTracksQuery } from "../../api/queries";
import type { SelectionDTO } from "../../api/types";
import { useAppStore } from "../../store/appStore";
import { useSelectionStore, toSelectionDTO } from "../../store/selectionStore";
import { CollapsibleSection } from "./CollapsibleSection";
import { MaskPanel } from "../controls/MaskPanel";
import { ProcessingPanel } from "../controls/ProcessingPanel";
import { SelectionPanel, type SelectionPanelBounds } from "../controls/SelectionPanel";

type ExploreTabContentProps = {
  /** Called when the user commits a selection change via the Apply button. */
  onCommitSelection: (dto: SelectionDTO) => void;
};

export function ExploreTabContent({ onCommitSelection }: ExploreTabContentProps) {
  const selectionState = useSelectionStore();
  // Memoise on primitives — without this the parent ships a fresh DTO on
  // every store mutation (hover events, SSE keep-alives, etc.), which
  // forces the SelectionPanel to keep re-syncing its draft from the prop
  // and visually wipes any in-progress slider drag. Mirrors the same
  // pattern in WorkspaceMain.
  const selectionDraft = useMemo<SelectionDTO>(
    () => toSelectionDTO(selectionState),
    [
      selectionState.timeCursor,
      selectionState.freq.freq,
      selectionState.spatial.ap,
      selectionState.spatial.ml,
      selectionState.spatial.channel,
    ],
  );

  const processingQuery = useProcessingQuery();
  const setProcessingMutation = useSetProcessing();

  const tracksQuery = useTracksQuery();
  const tracks = tracksQuery.data ?? [];
  const hasCategoricalTrack = tracks.some((t) => t.kind === "categorical");
  const {
    selectedTensor,
    brainstateOverlay,
    trackVisibility,
    toggleBrainstateOverlay,
    toggleTrackVisible,
    psdFmax,
    psdNW,
    psdWindowS,
    psdLockToEvent,
    freqLogScale,
    setPsdFmax,
    setPsdNW,
    setPsdWindowS,
    togglePsdLockToEvent,
    toggleFreqLogScale,
    specFmin,
    specFmax,
    specNpersegS,
    setSpecFmin,
    setSpecFmax,
    setSpecNpersegS,
  } = useAppStore();

  // Pull bounds for the SelectionPanel sliders from the active tensor's
  // coord summary so the time slider covers the full session (was hardcoded
  // 0..10, which clobbered any time>10 if the user touched it on a long
  // iEEG run). AP/ML use the tensor's grid shape; freq stays the
  // hardcoded 0..250 unless we add a freq coord to the source LFP later.
  const tensorQuery = useTensorQuery(selectedTensor);
  const tensorMeta = tensorQuery.data;
  const selectionBounds = useMemo<SelectionPanelBounds>(() => {
    const timeCoord = tensorMeta?.coords.find((c) => c.name === "time");
    const dims = tensorMeta?.dims ?? [];
    const shape = tensorMeta?.shape ?? [];
    const apIdx = dims.indexOf("AP");
    const mlIdx = dims.indexOf("ML");
    return {
      timeMin: typeof timeCoord?.min === "number" ? timeCoord.min : undefined,
      timeMax: typeof timeCoord?.max === "number" ? timeCoord.max : undefined,
      apMax: apIdx >= 0 ? Math.max(0, shape[apIdx] - 1) : undefined,
      mlMax: mlIdx >= 0 ? Math.max(0, shape[mlIdx] - 1) : undefined,
    };
  }, [tensorMeta]);

  return (
    <>
      <CollapsibleSection title="Processing" defaultOpen={true}>
        {processingQuery.data && (
          <ProcessingPanel
            params={processingQuery.data}
            onApply={(p) => setProcessingMutation.mutate(p)}
            isPending={setProcessingMutation.isPending}
            tensorName={selectedTensor ?? undefined}
          />
        )}
      </CollapsibleSection>

      {tracks.length > 0 && (
        <CollapsibleSection title="Context Tracks" defaultOpen={true}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "4px 0" }}>
            {tracks.map((t) => (
              <label
                key={t.name}
                style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}
                title={
                  t.kind === "categorical"
                    ? `states: ${t.state_names.join(", ")}`
                    : t.units
                      ? `units: ${t.units}`
                      : undefined
                }
              >
                <input
                  type="checkbox"
                  checked={trackVisibility[t.name] ?? true}
                  onChange={() => toggleTrackVisible(t.name)}
                />
                {t.name}
                {t.units ? <span style={{ color: "#8b949e" }}> ({t.units})</span> : null}
              </label>
            ))}
            {hasCategoricalTrack && (
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={brainstateOverlay}
                  onChange={toggleBrainstateOverlay}
                />
                Color overlay on traces
              </label>
            )}
          </div>
        </CollapsibleSection>
      )}

      <CollapsibleSection title="PSD Settings" defaultOpen={true}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "4px 0" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            F<sub>max</sub> (Hz)
            <input
              type="number"
              min={1}
              max={1000}
              step={10}
              value={psdFmax}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v) && v > 0) setPsdFmax(v);
              }}
              style={{ width: 60, fontSize: 12 }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            NW
            <input
              type="number"
              min={1}
              max={20}
              step={0.5}
              value={psdNW}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v) && v >= 1) setPsdNW(v);
              }}
              style={{ width: 60, fontSize: 12 }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            Window (s)
            <input
              type="number"
              min={0.01}
              max={60}
              step={0.1}
              value={psdWindowS}
              disabled={psdLockToEvent}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v) && v > 0) setPsdWindowS(v);
              }}
              style={{ width: 60, fontSize: 12 }}
            />
          </label>
          <label
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}
            title="When on, PSD time range tracks the selected event's [t, t_end] span instead of the window slider above."
          >
            <input
              type="checkbox"
              checked={psdLockToEvent}
              onChange={togglePsdLockToEvent}
              data-testid="psd-lock-to-event"
            />
            Lock PSD to selected event
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={freqLogScale}
              onChange={toggleFreqLogScale}
            />
            Log frequency scale
          </label>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Spectrogram Settings" defaultOpen={false}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "4px 0" }}>
          <div style={{ fontSize: 11, color: "#8b949e", lineHeight: 1.4 }}>
            TF panel band &amp; window. Raise F<sub>max</sub> to see fast bands
            (e.g. 250 Hz for ripples) — the default 0.5&ndash;30 Hz hides them.
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            F<sub>min</sub> (Hz)
            <input
              type="number"
              min={0}
              max={1000}
              step={0.5}
              value={specFmin}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v) && v >= 0) setSpecFmin(v);
              }}
              style={{ width: 60, fontSize: 12 }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            F<sub>max</sub> (Hz)
            <input
              type="number"
              min={1}
              max={1000}
              step={10}
              value={specFmax}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v) && v > 0) setSpecFmax(v);
              }}
              style={{ width: 60, fontSize: 12 }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            Window (s)
            <input
              type="number"
              min={0.01}
              max={60}
              step={0.1}
              value={specNpersegS}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v) && v > 0) setSpecNpersegS(v);
              }}
              style={{ width: 60, fontSize: 12 }}
            />
          </label>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Selection" defaultOpen={false}>
        <SelectionPanel
          selection={selectionDraft}
          bounds={selectionBounds}
          onSelectionChange={selectionState.patchFromDTO}
          onCommit={(s) => onCommitSelection(s)}
        />
      </CollapsibleSection>

      <CollapsibleSection title="Channel Mask" defaultOpen={false}>
        <MaskPanel
          tensorName={selectedTensor}
          nAP={(() => {
            const dims = tensorMeta?.dims ?? [];
            const shape = tensorMeta?.shape ?? [];
            const i = dims.indexOf("AP");
            return i >= 0 ? shape[i] : null;
          })()}
          nML={(() => {
            const dims = tensorMeta?.dims ?? [];
            const shape = tensorMeta?.shape ?? [];
            const i = dims.indexOf("ML");
            return i >= 0 ? shape[i] : null;
          })()}
        />
      </CollapsibleSection>
    </>
  );
}
