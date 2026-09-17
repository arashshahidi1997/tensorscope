/**
 * Arrow-key nudging of the time cursor by the smallest time unit.
 *
 *   ←  / →          move cursor by one sample period (the smallest unit)
 *   Shift+← / →     move cursor by 5 × the sample period
 *
 * The "smallest unit" is the spacing of the active tensor's `time` coord
 * (`(max - min) / (length - 1)`). Bails when focus is inside an input — same
 * convention as `useEventReviewShortcuts` — and when a modifier other than
 * Shift is held, so it never collides with browser/OS shortcuts.
 */
import { useEffect } from "react";
import { useSelectionStore } from "../../store/selectionStore";

type Args = {
  /** Sample period (s) — one smallest-unit step. null disables the shortcut. */
  step: number | null;
  /** Data time bounds for clamping; null skips that edge. */
  bounds: [number | null, number | null] | null;
  /** Commit the cursor move (server round-trip + optimistic update). */
  commit: (t: number) => void;
  enabled?: boolean;
};

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

export function useTimeCursorShortcuts({
  step,
  bounds,
  commit,
  enabled = true,
}: Args): void {
  useEffect(() => {
    if (!enabled || !step || !Number.isFinite(step) || step <= 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const mult = e.shiftKey ? 5 : 1;
      const delta = (e.key === "ArrowRight" ? 1 : -1) * step * mult;
      let t = useSelectionStore.getState().timeCursor + delta;
      const lo = bounds?.[0];
      const hi = bounds?.[1];
      if (lo != null && Number.isFinite(lo)) t = Math.max(lo, t);
      if (hi != null && Number.isFinite(hi)) t = Math.min(hi, t);
      commit(t);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, step, bounds, commit]);
}
