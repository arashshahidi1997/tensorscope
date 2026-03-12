import { useStateQuery, useTensorQuery } from "../../api/queries";
import { useAppStore } from "../../store/appStore";
import type { TensorSummaryDTO } from "../../api/types";

/**
 * Tensor Browser — lists all tensors in the session with click-to-select
 * and expanded detail for the active tensor.
 */
export function TensorBrowserTab() {
  const { data: state, isLoading, error } = useStateQuery();
  const selectedTensor = useAppStore((s) => s.selectedTensor);
  const setSelectedTensor = useAppStore((s) => s.setSelectedTensor);

  if (isLoading) return <p className="muted">Loading tensors...</p>;
  if (error) return <p className="muted">Failed to load tensors.</p>;
  if (!state || state.tensors.length === 0) return <p className="muted">No tensors.</p>;

  return (
    <div className="tensor-list">
      {state.tensors.map((t) => (
        <TensorItem
          key={t.name}
          tensor={t}
          isActive={t.name === selectedTensor}
          onSelect={setSelectedTensor}
        />
      ))}
    </div>
  );
}

type TensorItemProps = {
  tensor: TensorSummaryDTO;
  isActive: boolean;
  onSelect: (name: string) => void;
};

function TensorItem({ tensor, isActive, onSelect }: TensorItemProps) {
  const isDerived = tensor.source !== null;

  return (
    <div
      className={`tensor-item${isActive ? " tensor-item--active" : ""}`}
      onClick={() => onSelect(tensor.name)}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span className="tensor-name">{tensor.name}</span>
        <span
          className={`tensor-badge ${isDerived ? "tensor-badge--derived" : "tensor-badge--source"}`}
        >
          {isDerived ? "derived" : "source"}
        </span>
      </div>
      <div className="tensor-dims">
        ({tensor.dims.join(", ")})
      </div>
      <div className="tensor-dims" style={{ opacity: 0.7 }}>
        [{tensor.shape.join(", ")}]
      </div>
      {isDerived && tensor.transform && (
        <div className="tensor-dims">
          transform: {tensor.transform}
        </div>
      )}
      {isActive && <TensorDetail name={tensor.name} />}
    </div>
  );
}

function TensorDetail({ name }: { name: string }) {
  const { data: meta, isLoading } = useTensorQuery(name);

  if (isLoading) return <div className="tensor-detail">Loading...</div>;
  if (!meta) return null;

  return (
    <div className="tensor-detail">
      {meta.coords.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>Coordinates</div>
          {meta.coords.map((c) => {
            const minVal = c.min !== null && c.min !== undefined ? String(c.min) : "?";
            const maxVal = c.max !== null && c.max !== undefined ? String(c.max) : "?";
            return (
              <div key={c.name} style={{ paddingLeft: 4 }}>
                <span style={{ color: "var(--accent)" }}>{c.name}</span>{" "}
                <span>({c.dtype}, {c.length})</span>{" "}
                <span>[{minVal} .. {maxVal}]</span>
              </div>
            );
          })}
        </div>
      )}
      {meta.available_views.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>Available views</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
            {meta.available_views.map((v) => (
              <span key={v} className="tensor-badge tensor-badge--source">
                {v}
              </span>
            ))}
          </div>
        </div>
      )}
      {meta.source && (
        <div>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>Lineage</div>
          <div style={{ paddingLeft: 4 }}>
            Source: <span style={{ color: "var(--accent)" }}>{meta.source}</span>
            {meta.transform && (
              <span> via <strong>{meta.transform}</strong></span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
