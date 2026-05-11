/**
 * `[` / `]` shortcuts to scroll the timeseries channel viewport.
 * Shift+`[` / Shift+`]` advance by a full page.
 *
 * Bails when focus is inside an input — same convention as
 * `useEventReviewShortcuts`. See
 * `docs/design/channel-viewport.md` G2.
 */
import { useEffect } from "react";
import { useAppStore } from "../../store/appStore";

type Args = {
  /** Total channel count for the active tensor; needed for clamp. */
  totalChannels: number;
  /** Visible-window size. v0 is fixed at 32. */
  nVisible: number;
  enabled?: boolean;
};

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

export function useChannelViewportShortcuts({
  totalChannels,
  nVisible,
  enabled = true,
}: Args): void {
  const scrollChannels = useAppStore((s) => s.scrollChannels);
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== "[" && e.key !== "]") return;
      e.preventDefault();
      const step = e.shiftKey ? nVisible : Math.max(1, Math.floor(nVisible / 4));
      const delta = e.key === "]" ? step : -step;
      scrollChannels(delta, totalChannels, nVisible);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, totalChannels, nVisible, scrollChannels]);
}
