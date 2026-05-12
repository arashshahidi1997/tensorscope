/**
 * Bokeh-style keyboard shortcuts for switching between gesture tools.
 *
 *   p   pan
 *   b   box zoom
 *   s   box select  (placeholder — drag handler isn't wired in v1)
 *   w   toggle wheel-zoom on/off
 *   c   toggle crosshair inspector
 *   r   reset zoom on the currently-focused chart (handled by views)
 *
 * Bails inside inputs / textareas / contenteditable so typing in a
 * filter / note doesn't fire tool switches. The `r` reset isn't handled
 * here — it's a chart-local action; views bind it via their own toolbar
 * button + their own keydown handler if needed.
 */
import { useEffect } from "react";
import { useGestureStore } from "../../store/gestureStore";

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

export function useGestureShortcuts(enabled = true): void {
  const setDrag = useGestureStore((s) => s.setDrag);
  const setScroll = useGestureStore((s) => s.setScroll);
  const toggleInspector = useGestureStore((s) => s.toggleInspector);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      switch (k) {
        case "p":
          e.preventDefault();
          setDrag("pan");
          return;
        case "b":
          e.preventDefault();
          setDrag("box_zoom");
          return;
        case "s":
          e.preventDefault();
          setDrag("box_select");
          return;
        case "w": {
          e.preventDefault();
          // Toggle wheel-zoom on/off. We don't have a wheel_pan variant
          // yet; until that lands, w cycles between "wheel_zoom" and
          // "off" only.
          const cur = useGestureStore.getState().scroll;
          setScroll(cur === "wheel_zoom" ? "off" : "wheel_zoom");
          return;
        }
        case "c":
          e.preventDefault();
          toggleInspector("crosshair");
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, setDrag, setScroll, toggleInspector]);
}
