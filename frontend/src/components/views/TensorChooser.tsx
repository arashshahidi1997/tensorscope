import type { TensorSummaryDTO } from "../../api/types";

type Props = {
  tensors: TensorSummaryDTO[];
  selectedTensor: string;
  onSelectTensor: (name: string) => void;
};

export function TensorChooser({ tensors, selectedTensor, onSelectTensor }: Props) {
  if (tensors.length <= 1) return null;
  return (
    <div className="pill-row">
      {tensors.map((t) => (
        <button
          key={t.name}
          type="button"
          className={t.name === selectedTensor ? "pill active" : "pill"}
          onClick={() => onSelectTensor(t.name)}
        >
          {t.name}
        </button>
      ))}
    </div>
  );
}
