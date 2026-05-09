import { useMemo } from "react";
import type { SelectionDTO } from "../../api/types";

/**
 * Bounds for the per-axis sliders. Falls back to permissive defaults when
 * omitted, but the parent should pass actual tensor coord bounds whenever
 * available so the time slider covers the full session (the previous
 * hardcoded `time: 0..10` clobbered any t>10 selection on long iEEG runs).
 */
export type SelectionPanelBounds = {
  timeMin?: number;
  timeMax?: number;
  freqMin?: number;
  freqMax?: number;
  apMax?: number;
  mlMax?: number;
};

type Props = {
  selection: SelectionDTO;
  /** Drag/scrub callback — fires on every slider input. Wire to a store
   *  setter (e.g. `patchFromDTO`) so views update live. */
  onSelectionChange: (patch: Partial<SelectionDTO>) => void;
  /** Apply button — commits the *current* selection to the server. */
  onCommit: (selection: SelectionDTO) => void;
  bounds?: SelectionPanelBounds;
};

/**
 * SelectionPanel — slider + numeric editor for cursor coordinates.
 *
 * UX contract: drags fire `onSelectionChange` immediately so all linked
 * views update live. Apply fires `onCommit(selection)` which is the
 * server-side PUT. Use this whenever the user wants to scrub through
 * data; the server commit only matters when a paired agent or other
 * client also needs to see the change.
 *
 * No local draft: the slider's `value` reads directly from `selection`.
 * Earlier versions kept a local draft to defer commits but that froze
 * views during drags, which is the opposite of what users expect on a
 * raw-data exploration tool.
 */
export function SelectionPanel({
  selection,
  onSelectionChange,
  onCommit,
  bounds,
}: Props) {
  const timeMin = bounds?.timeMin ?? 0;
  const timeMax = bounds?.timeMax ?? Math.max(10, selection.time + 1);
  const freqMin = bounds?.freqMin ?? 0;
  const freqMax = bounds?.freqMax ?? 250;
  const apMax = bounds?.apMax ?? 16;
  const mlMax = bounds?.mlMax ?? 16;

  const controls = useMemo(
    () => [
      { key: "time" as const, label: "t (s)", min: timeMin, max: timeMax, step: 0.01, value: selection.time },
      { key: "freq" as const, label: "f (Hz)", min: freqMin, max: freqMax, step: 1, value: selection.freq },
      { key: "ap"   as const, label: "AP",   min: 0, max: apMax, step: 1, value: selection.ap },
      { key: "ml"   as const, label: "ML",   min: 0, max: mlMax, step: 1, value: selection.ml },
    ],
    [selection, timeMin, timeMax, freqMin, freqMax, apMax, mlMax],
  );

  const setAxis = (key: "time" | "freq" | "ap" | "ml", raw: string, isFloat: boolean) => {
    const next = isFloat ? Number.parseFloat(raw) : Number.parseInt(raw, 10);
    if (!Number.isFinite(next)) return;
    onSelectionChange({ [key]: next });
  };

  return (
    <div className="panel">
      <div className="panel-title">Selection</div>
      {controls.map((ctrl) => {
        const isFloat = ctrl.step < 1;
        return (
          <label className="slider-row" key={ctrl.key}>
            <span>{ctrl.label}</span>
            <input
              type="range"
              min={ctrl.min}
              max={ctrl.max}
              step={ctrl.step}
              value={ctrl.value}
              onChange={(e) => setAxis(ctrl.key, e.target.value, isFloat)}
            />
            <input
              type="number"
              min={ctrl.min}
              max={ctrl.max}
              step={ctrl.step}
              value={ctrl.value}
              onChange={(e) => setAxis(ctrl.key, e.target.value, isFloat)}
              style={{ width: 76, fontSize: 12 }}
            />
          </label>
        );
      })}
      <button
        className="action-button"
        onClick={() => onCommit(selection)}
        type="button"
        title="Commit selection to server (PUT /selection)"
      >
        Apply
      </button>
    </div>
  );
}
