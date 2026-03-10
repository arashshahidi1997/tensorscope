import type { TensorSummaryDTO } from "../../api/types";

type TensorChooserProps = {
  tensors: TensorSummaryDTO[];
  selectedTensor: string;
  onSelectTensor: (name: string) => void;
};

export function TensorChooser({
  tensors,
  selectedTensor,
  onSelectTensor,
}: TensorChooserProps) {
  return (
    <div className="control-stack">
      <div className="panel-heading">
        <h2>Tensors</h2>
        <p>Available tensor registry entries from `/api/v1/state`.</p>
      </div>
      <div className="pill-list">
        {tensors.map((tensor) => (
          <button
            className={tensor.name === selectedTensor ? "pill active" : "pill"}
            key={tensor.name}
            onClick={() => onSelectTensor(tensor.name)}
            type="button"
          >
            {tensor.name}
          </button>
        ))}
      </div>
    </div>
  );
}
