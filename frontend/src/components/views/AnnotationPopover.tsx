/**
 * Inline popover for editing a single event's review annotation:
 * status, free-form notes, and a list of tags. Spec:
 * `docs/log/issue/task-g6-event-notes-tags-...md`.
 *
 * Commits the current values when the user blurs outside the popover,
 * presses Escape, or presses Cmd/Ctrl+Enter. The "pending" status sends
 * a clear signal back so the caller can drop the decision (notes and
 * tags don't survive that — see the v0 trade-off in the store header).
 */
import { useEffect, useRef, useState } from "react";
import type { EventReviewStatus } from "../../store/eventReviewStore";

export type AnnotationStatusChoice = EventReviewStatus | "pending";

export type AnnotationPopoverValue = {
  status: AnnotationStatusChoice;
  notes: string;
  tags: string[];
};

type Props = {
  initial: AnnotationPopoverValue;
  onCommit: (next: AnnotationPopoverValue) => void;
  onCancel: () => void;
};

const STATUS_CHOICES: AnnotationStatusChoice[] = [
  "accepted",
  "rejected",
  "maybe",
  "pending",
];

export function parseTagsInput(s: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of s.split(",")) {
    const t = raw.trim();
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function tagsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function AnnotationPopover({ initial, onCommit, onCancel }: Props) {
  const [status, setStatus] = useState<AnnotationStatusChoice>(initial.status);
  const [notes, setNotes] = useState<string>(initial.notes);
  const [tagsText, setTagsText] = useState<string>(initial.tags.join(", "));
  const rootRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Per spec, focus the notes textarea when the popover opens —
    // matches Neuroscope2's "edit cluster" gesture.
    notesRef.current?.focus();
  }, []);

  const isUnchanged = (): boolean => {
    if (status !== initial.status) return false;
    if (notes !== initial.notes) return false;
    return tagsEqual(parseTagsInput(tagsText), initial.tags);
  };

  const commit = () => {
    onCommit({ status, notes, tags: parseTagsInput(tagsText) });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (isUnchanged()) onCancel();
      else commit();
      return;
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      commit();
    }
  };

  const handleBlur = (e: React.FocusEvent) => {
    // relatedTarget = focus destination. If it's still inside the
    // popover root, we're just moving between fields — don't commit.
    const dest = e.relatedTarget as Node | null;
    if (rootRef.current && dest && rootRef.current.contains(dest)) return;
    if (isUnchanged()) onCancel();
    else commit();
  };

  return (
    <div
      ref={rootRef}
      className="annotation-popover"
      role="dialog"
      aria-label="Edit event annotation"
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      onClick={(e) => e.stopPropagation()}
    >
      <fieldset className="annotation-status">
        <legend className="muted">Status</legend>
        {STATUS_CHOICES.map((s) => (
          <label key={s} className={`annotation-status-${s}`}>
            <input
              type="radio"
              name="annotation-status"
              value={s}
              checked={status === s}
              onChange={() => setStatus(s)}
            />
            <span>{s}</span>
          </label>
        ))}
      </fieldset>
      <textarea
        ref={notesRef}
        className="annotation-notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes…"
        rows={2}
        aria-label="Event notes"
      />
      <input
        type="text"
        className="annotation-tags"
        value={tagsText}
        onChange={(e) => setTagsText(e.target.value)}
        placeholder="tag1, tag2"
        aria-label="Event tags (comma-separated)"
      />
      <div className="annotation-hint muted">
        ⌘+Enter saves · Esc closes
      </div>
    </div>
  );
}
