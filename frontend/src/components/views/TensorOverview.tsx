import type { TensorMetaDTO } from "../../api/types";

type TensorOverviewProps = {
  tensor: TensorMetaDTO;
  selectedView: string;
  onSelectView: (view: string) => void;
};

export function TensorOverview({
  tensor,
  selectedView,
  onSelectView,
}: TensorOverviewProps) {
  return (
    <div className="control-stack">
      <div className="panel-heading">
        <h2>Tensor</h2>
        <p>Metadata from the tensor detail endpoint.</p>
      </div>

      <div className="meta-grid">
        <div>
          <span className="meta-label">Name</span>
          <strong>{tensor.name}</strong>
        </div>
        <div>
          <span className="meta-label">Dims</span>
          <strong>{tensor.dims.join(" × ")}</strong>
        </div>
        <div>
          <span className="meta-label">Shape</span>
          <strong>{tensor.shape.join(" × ")}</strong>
        </div>
        <div>
          <span className="meta-label">Type</span>
          <strong>{tensor.dtype}</strong>
        </div>
      </div>

      <div className="pill-list">
        {tensor.available_views.map((view) => (
          <button
            className={view === selectedView ? "pill active" : "pill"}
            key={view}
            onClick={() => onSelectView(view)}
            type="button"
          >
            {view}
          </button>
        ))}
      </div>

      <div className="coord-table">
        {tensor.coords.map((coord) => (
          <article className="coord-card" key={coord.name}>
            <strong>{coord.name}</strong>
            <span>
              {coord.dtype} · {coord.length}
            </span>
            <span>
              {String(coord.min)} to {String(coord.max)}
            </span>
          </article>
        ))}
      </div>
    </div>
  );
}
