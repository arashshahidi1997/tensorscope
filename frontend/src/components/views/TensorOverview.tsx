import type { TensorMetaDTO } from "../../api/types";

type Props = {
  tensor: TensorMetaDTO;
  /**
   * Frontend-expanded view ids (the same list the WorkspaceMain rendering
   * paths key off — `psd_heatmap`/`psd_curve`/`psd_spatial` instead of the
   * server-internal `psd_live`). Driving the chips from the server's
   * `tensor.available_views` directly produced a vocabulary mismatch:
   * clicking the `psd_live` chip pushed a literal "psd_live" into
   * activeViews, but no rendering check ever read that string, so toggles
   * silently broke neighbouring views (e.g. spectrogram_live disappearing
   * after a chip-flip sequence). See
   * docs/log/issue/issue-arash-20260508-142724-956601.md for the broader
   * vocabulary-alignment thread.
   */
  availableViews: string[];
  activeViews: string[];
  onToggleView: (view: string) => void;
};

export function TensorOverview({ tensor, availableViews, activeViews, onToggleView }: Props) {
  const effectiveActive =
    activeViews.length === 0 ? availableViews : activeViews;

  return (
    <div className="panel">
      <div className="meta-row" style={{ marginBottom: 6 }}>
        <span><strong>{tensor.name}</strong></span>
        <span className="muted">{tensor.dims.join("×")} — {tensor.shape.join("×")}</span>
        <span className="muted">{tensor.dtype}</span>
      </div>
      <div className="pill-row">
        {availableViews.map((v) => (
          <button
            key={v}
            type="button"
            className={effectiveActive.includes(v) ? "pill active" : "pill"}
            onClick={() => onToggleView(v)}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}
