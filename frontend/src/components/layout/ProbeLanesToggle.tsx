/**
 * ProbeLanesToggle — one-click entry into the multi-probe "Probe lanes" layout
 * (Track C3/C5). Flips the view-grid layout to the 3-row ecog+npx preset (and,
 * via setGridLayout, multiProbeMode + the default npx slot routing). Only shown
 * when the session actually has ≥2 tensors — it's meaningless on one probe.
 */
import { useStateQuery } from "../../api/queries";
import { useAppStore } from "../../store/appStore";

export function ProbeLanesToggle() {
  const stateQuery = useStateQuery();
  const gridLayout = useAppStore((s) => s.gridLayout);
  const setGridLayout = useAppStore((s) => s.setGridLayout);

  const tensorCount = stateQuery.data?.tensors?.length ?? 0;
  if (tensorCount < 2) return null;

  const on = gridLayout === "probe_lanes";
  return (
    <button
      type="button"
      className={`topbar-chip${on ? " active" : ""}`}
      onClick={() => setGridLayout(on ? "default" : "probe_lanes")}
      title="Probe lanes — ECoG + Neuropixels on a shared time axis (multi-probe)"
      aria-pressed={on}
      style={{
        cursor: "pointer",
        background: "transparent",
        font: "inherit",
        border: on ? "1px solid var(--accent)" : "1px solid transparent",
        borderRadius: 6,
      }}
    >
      ⊞ Probe lanes
    </button>
  );
}
