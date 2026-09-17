import { useSelectionStore } from "../../store/selectionStore";

/**
 * Shared-playhead readout for multi-probe lanes: the cursor's ABSOLUTE
 * session-clock time. Rendered in each time-axis panel's header in the
 * probe-lanes layout, so cross-probe alignment is legible — the number is
 * identical in every lane precisely because both probes are served on one
 * shared clock (pixecog load_aligned; see neuropixels-multiprobe.md §Phase 3).
 *
 * Self-subscribing: only this chip re-renders on cursor moves, not the
 * panel (Invariant 4 — headers stay out of the hot path).
 */
export function CursorTimeChip() {
  const t = useSelectionStore((s) => s.timeCursor);
  return (
    <span
      className="panel-badge panel-time-chip"
      data-testid="panel-time-chip"
      title="Shared playhead — absolute session-clock time, identical in every lane"
    >
      ⌖ {t.toFixed(3)} s
    </span>
  );
}
