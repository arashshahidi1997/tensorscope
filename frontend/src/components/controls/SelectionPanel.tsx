import { useMemo } from "react";
import type { SelectionDTO } from "../../api/types";

type SelectionPanelProps = {
  selection: SelectionDTO;
  onSelectionChange: (patch: Partial<SelectionDTO>) => void;
  onCommit: () => void;
};

export function SelectionPanel({
  selection,
  onSelectionChange,
  onCommit,
}: SelectionPanelProps) {
  const controls = useMemo(
    () => [
      { key: "time", label: "Time", min: 0, max: 10, step: 0.1, value: selection.time },
      { key: "freq", label: "Freq", min: 0, max: 250, step: 1, value: selection.freq },
      { key: "ap", label: "AP", min: 0, max: 16, step: 1, value: selection.ap },
      { key: "ml", label: "ML", min: 0, max: 16, step: 1, value: selection.ml },
    ],
    [selection],
  );

  return (
    <div className="control-stack">
      <div className="panel-heading">
        <h2>Selection</h2>
        <p>Optimistic local draft mirrored to the API when applied.</p>
      </div>

      {controls.map((control) => (
        <label className="slider-row" key={control.key}>
          <span>{control.label}</span>
          <input
            type="range"
            min={control.min}
            max={control.max}
            step={control.step}
            value={control.value}
            onChange={(event) =>
              onSelectionChange({
                [control.key]:
                  control.step === 1
                    ? Number.parseInt(event.target.value, 10)
                    : Number.parseFloat(event.target.value),
              })
            }
          />
          <strong>{control.value}</strong>
        </label>
      ))}

      <button className="action-button" onClick={onCommit} type="button">
        Apply Selection
      </button>
    </div>
  );
}
