/**
 * Keyboard shortcuts for spindle-style event review.
 *
 *   j  → next event
 *   k  → prev event
 *   y  → accept current event
 *   n  → reject current event
 *   m  → maybe (uncertain) current event
 *   u  → clear decision on current event
 *
 * Shortcuts are GLOBAL — the listener is on `window`. They bail when
 * focus is inside an input-like element (textarea, contenteditable, etc.)
 * so typing in the PSD window-size box doesn't fire `n` and reject
 * whatever event the cursor is on.
 *
 * Spec: `docs/design/event-review.md`. Per the issue note
 * (`issue-arash-20260511-182119-502518.md` G3), keyboard nav is the
 * single biggest review-ergonomics win — it's the floor of any 1000-
 * event review workflow.
 */
import { useEffect } from "react";
import {
  decisionKey,
  useEventReviewStore,
  type EventReviewStatus,
} from "../../store/eventReviewStore";

type Args = {
  /** Active tensor name (decision-key scope). */
  tensorName: string | null;
  /** Active event stream name (decision-key scope). */
  streamName: string | null;
  /** Identity of the event currently under review, if any. */
  currentEventId: string | number | null;
  /** Step the cursor to the prev/next event in the stream. */
  goPrev: () => void;
  goNext: () => void;
  /** When false, shortcuts no-op. Use for split screens / preview modes. */
  enabled?: boolean;
};

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

export function useEventReviewShortcuts({
  tensorName,
  streamName,
  currentEventId,
  goPrev,
  goNext,
  enabled = true,
}: Args): void {
  // Stash callbacks in refs so the listener can capture them without
  // re-binding on every render. The closure reads `.current` at fire time
  // so it always sees the latest functions / scope.
  const setDecision = useEventReviewStore((s) => s.setDecision);
  const clearDecision = useEventReviewStore((s) => s.clearDecision);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "j") {
        e.preventDefault();
        goNext();
        return;
      }
      if (k === "k") {
        e.preventDefault();
        goPrev();
        return;
      }
      // The decision keys all require an active event + scope. Without
      // them the shortcut is a silent no-op (NOT a beep / error toast —
      // false positives during normal typing would be more annoying than
      // the silent miss).
      if (!tensorName || !streamName || currentEventId == null) return;
      const dk = decisionKey(tensorName, streamName, currentEventId);
      const status = decisionKeyMap[k];
      if (status === undefined) return;
      e.preventDefault();
      if (status === null) clearDecision(dk);
      else setDecision(dk, status);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    enabled,
    tensorName,
    streamName,
    currentEventId,
    goPrev,
    goNext,
    setDecision,
    clearDecision,
  ]);
}

// `null` means "clear the decision". Keep `u` (undo) separate from the
// status set so future statuses don't collide with the unmark glyph.
const decisionKeyMap: Record<string, EventReviewStatus | null | undefined> = {
  y: "accepted",
  n: "rejected",
  m: "maybe",
  u: null,
};
