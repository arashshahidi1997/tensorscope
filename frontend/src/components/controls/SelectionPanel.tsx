import { useMemo } from "react";
import type { SelectionDTO } from "../../api/types";

type Props = {
  selection: SelectionDTO;
  onSelectionChange: (patch: Partial<SelectionDTO>) => void;
  onCommit: () => void;
};

export function SelectionPanel({ selection, onSelectionChange, onCommit }: Props) {
  const controls = useMemo(
    () => [
      { key: "time", label: "t", min: 0, max: 10, step: 0.01, value: selection.time },
      { key: "freq", label: "f", min: 0, max: 250, step: 1, value: selection.freq },
      { key: "ap", label: "AP", min: 0, max: 16, step: 1, value: selection.ap },
      { key: "ml", label: "ML", min: 0, max: 16, step: 1, value: selection.ml },
    ],
    [selection],
  );

  return (
    <div className="panel">
      <div className="panel-title">Selection</div>
      {controls.map((ctrl) => (
        <label className="slider-row" key={ctrl.key}>
          <span>{ctrl.label}</span>
          <input
            type="range"
            min={ctrl.min}
            max={ctrl.max}
            step={ctrl.step}
            value={ctrl.value}
            onChange={(e) =>
              onSelectionChange({
                [ctrl.key]: ctrl.step < 1
                  ? Number.parseFloat(e.target.value)
                  : Number.parseInt(e.target.value, 10),
              })
            }
          />
          <span className="val">{typeof ctrl.value === "number" ? ctrl.value.toFixed(ctrl.step < 1 ? 2 : 0) : ctrl.value}</span>
        </label>
      ))}
      <button className="action-button" onClick={onCommit} type="button">Apply</button>
    </div>
  );
}
