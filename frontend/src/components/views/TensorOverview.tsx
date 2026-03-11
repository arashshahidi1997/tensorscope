import type { TensorMetaDTO } from "../../api/types";

type Props = {
  tensor: TensorMetaDTO;
  activeViews: string[];
  onToggleView: (view: string) => void;
};

export function TensorOverview({ tensor, activeViews, onToggleView }: Props) {
  const effectiveActive =
    activeViews.length === 0 ? tensor.available_views : activeViews;

  return (
    <div className="panel">
      <div className="meta-row" style={{ marginBottom: 6 }}>
        <span><strong>{tensor.name}</strong></span>
        <span className="muted">{tensor.dims.join("×")} — {tensor.shape.join("×")}</span>
        <span className="muted">{tensor.dtype}</span>
      </div>
      <div className="pill-row">
        {tensor.available_views.map((v) => (
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
