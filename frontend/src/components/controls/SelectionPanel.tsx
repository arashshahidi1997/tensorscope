import { useEffect, useMemo, useRef, useState } from "react";
import type { SelectionDTO } from "../../api/types";

/**
 * Bounds for the per-axis sliders. Falls back to the previous hardcoded
 * defaults (`time: 0..10`, `freq: 0..250`, `ap/ml: 0..16`) when omitted —
 * but those are wrong for any real session, so the parent should pass
 * actual tensor coord bounds whenever they're available.
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
  onCommit: (draft: SelectionDTO) => void;
  bounds?: SelectionPanelBounds;
  /**
   * Optional: forward slider drags to a parent listener (e.g. for live
   * scrubbing). The panel does NOT call this on its own initiative — by
   * default slider drags only update the panel's local draft, so the
   * Apply button is the explicit commit point.
   */
  onSelectionChange?: (patch: Partial<SelectionDTO>) => void;
};

/**
 * SelectionPanel — slider-driven cursor editor with a deferred commit.
 *
 * UX contract: dragging sliders mutates a *local draft* only. The Apply
 * button is the single point at which the draft is committed (PUT to
 * /api/v1/selection upstream, which propagates to the store + all linked
 * views via the SSE/mutation flow).
 *
 * Why local draft (changed 2026-05-09): the previous version pushed every
 * intermediate slider value into the global store via `patchFromDTO`,
 * which made Apply a no-op (the store was already mutated as you
 * dragged). It also meant accidentally touching the time slider — whose
 * range was hardcoded `0..10` — instantly clobbered any valid
 * `time > 10 s` selection on long iEEG sessions. Now the panel re-syncs
 * its draft only when the external `selection` prop's identity changes
 * (e.g. after a successful Apply, an SSE selection_changed, or an event
 * navigation jump).
 */
export function SelectionPanel({
  selection,
  onCommit,
  bounds,
  onSelectionChange,
}: Props) {
  const [draft, setDraft] = useState<SelectionDTO>(selection);

  // Re-sync local draft when external selection identity changes — e.g.
  // after Apply (mutation onSuccess→initFromDTO), SSE selection_changed,
  // or an EventTable jump. Object identity is the right gate: if the
  // store/parent produced a fresh DTO, the upstream selection truly
  // changed; if not, the user is mid-drag and we keep the local draft.
  const prevSelectionRef = useRef<SelectionDTO | null>(null);
  useEffect(() => {
    if (prevSelectionRef.current !== selection) {
      prevSelectionRef.current = selection;
      setDraft(selection);
    }
  }, [selection]);

  const timeMin = bounds?.timeMin ?? 0;
  const timeMax = bounds?.timeMax ?? Math.max(10, draft.time + 1);
  const freqMin = bounds?.freqMin ?? 0;
  const freqMax = bounds?.freqMax ?? 250;
  const apMax = bounds?.apMax ?? 16;
  const mlMax = bounds?.mlMax ?? 16;

  const controls = useMemo(
    () => [
      { key: "time" as const, label: "t", min: timeMin, max: timeMax, step: 0.01, value: draft.time },
      { key: "freq" as const, label: "f", min: freqMin, max: freqMax, step: 1, value: draft.freq },
      { key: "ap" as const, label: "AP", min: 0, max: apMax, step: 1, value: draft.ap },
      { key: "ml" as const, label: "ML", min: 0, max: mlMax, step: 1, value: draft.ml },
    ],
    [draft, timeMin, timeMax, freqMin, freqMax, apMax, mlMax],
  );

  const dirty = (
    draft.time !== selection.time ||
    draft.freq !== selection.freq ||
    draft.ap !== selection.ap ||
    draft.ml !== selection.ml ||
    draft.channel !== selection.channel
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
            onChange={(e) => {
              const next = ctrl.step < 1
                ? Number.parseFloat(e.target.value)
                : Number.parseInt(e.target.value, 10);
              setDraft((d) => ({ ...d, [ctrl.key]: next }));
              onSelectionChange?.({ [ctrl.key]: next });
            }}
          />
          <input
            type="number"
            min={ctrl.min}
            max={ctrl.max}
            step={ctrl.step}
            value={ctrl.value}
            onChange={(e) => {
              const raw = ctrl.step < 1
                ? Number.parseFloat(e.target.value)
                : Number.parseInt(e.target.value, 10);
              if (!Number.isFinite(raw)) return;
              setDraft((d) => ({ ...d, [ctrl.key]: raw }));
              onSelectionChange?.({ [ctrl.key]: raw });
            }}
            className="val-input"
            style={{ width: 76, fontSize: 12 }}
          />
        </label>
      ))}
      <button
        className="action-button"
        onClick={() => onCommit(draft)}
        type="button"
        disabled={!dirty}
        title={dirty ? "Commit draft to server (PUT /selection)" : "Nothing to apply"}
      >
        {dirty ? "Apply" : "Applied"}
      </button>
    </div>
  );
}
