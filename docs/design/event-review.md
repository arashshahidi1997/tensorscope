# Event review — keyboard navigation + decision storage

**Status:** spec
**Created:** 2026-05-11
**Tracks:** [issue-arash-20260511-182119-502518](../log/issue/issue-arash-20260511-182119-502518.md) G3

## Problem

A spindle reviewer walks through 1000+ detected events, accept/reject/maybe
each. TensorScope's current event panel has prev/next buttons and a click-
to-jump table — adequate at 10 events, useless at 1000. Per the gap doc:

- No keyboard shortcuts (mouse-only is RSI in 10 min)
- No accept/reject/maybe controls per event
- No live "x of N reviewed" counter
- No filter "show only unvalidated"
- No persistence of decisions — every session re-does work

## Approach

Pure frontend, no server changes for v0. Decisions persist in
`localStorage` keyed by `(tensor, streamName, eventId)`. A later phase
adds a server endpoint to push the decisions to disk.

## Data model

```ts
type EventDecision = {
  status: "accepted" | "rejected" | "maybe";
  decidedAt: number;            // unix ms
  notes?: string;               // free-form text, optional
  tags?: string[];              // tags, optional
};

type EventReviewStore = {
  // Keyed by `${tensorName}|${streamName}|${eventId}` to scope per session.
  decisions: Record<string, EventDecision>;
  setDecision: (key: string, status: EventDecision["status"]) => void;
  clearDecision: (key: string) => void;
  updateNotes: (key: string, notes: string) => void;
  // Bulk operations for clearing a stream / tensor scope (e.g. on a new dataset).
  clearStream: (tensorName: string, streamName: string) => void;
};
```

Persistence: Zustand's `persist` middleware, key `tensorscope:event-review`.
v0 is intentionally local-only; the dataset bundle stays untouched.

## Keyboard contract

When focus is in the page body (NOT inside an `<input>` / `<textarea>` /
`[contenteditable]`):

| Key | Action |
|---|---|
| `j` | Next event in stream |
| `k` | Prev event in stream |
| `y` | Mark current event accepted |
| `n` | Mark current event rejected |
| `m` | Mark current event maybe |
| `u` | Clear decision (un-mark) |

Implementation: a `useEventReviewShortcuts()` hook installs a single
`keydown` listener on `window`. Bails if the focused element is in the
guard list above (matches `event.target` against `INPUT`, `TEXTAREA`,
`[contenteditable]`).

A user typing in a `<input>` (e.g. PSD window-size box) does NOT trigger
shortcuts — this matches Neuroscope2 / VS Code / Sublime conventions.

## UI changes

### EventTableView

- New leading column: status badge (●○○ or color glyph). Accepted = green,
  rejected = red, maybe = amber, pending = grey.
- New trailing column: notes preview (truncated if present).
- Status filter dropdown above the table: `All | Pending | Accepted |
  Rejected | Maybe`.
- Counter in the panel heading: `42 of 312 reviewed` (decisions / total).

### Inline edit (deferred to v0.1)

Click status badge → cycle status (pending → accepted → rejected → maybe →
pending). Click notes column → focuses a popover input.

For v0: keyboard shortcuts only. The badge is read-only. Click-to-cycle is
v0.1.

## Out of scope (v0)

- Server-side persistence of decisions
- Multi-reviewer / inter-rater agreement
- Export to disk (`validated_spindles.parquet`) — that's G9, separate spec
- Note editing UI — text field appears in v0.1
- Tags — v0.1

These are deliberately deferred so the keyboard + persisted-decision loop
can ship and be used. Each deferral is a follow-up issue.

## Acceptance

1. With the event panel open and focus in the page body, `j`/`k` step
   through events. Hold either key — autorepeat works.
2. `y`/`n`/`m`/`u` set/clear the decision on the currently selected
   event. The badge in the table updates immediately.
3. Closing the tab and reopening the app restores all decisions.
4. The counter `X of N reviewed` is accurate. `X` excludes `pending`.
5. Filter dropdown narrows the table to the selected status set.
6. Tests: store mutations, key bindings (focus guard works), counter math.

## Files touched

- `frontend/src/store/eventReviewStore.ts` (new)
- `frontend/src/store/eventReviewStore.test.ts` (new)
- `frontend/src/components/views/useEventReviewShortcuts.ts` (new)
- `frontend/src/components/views/EventTableView.tsx` (badge, counter, filter)
- `frontend/src/components/views/EventTableView.test.ts` (new, light)
- `frontend/src/components/layout/EventsTabContent.tsx` (pass tensorName)
- `frontend/src/App.tsx` (mount the keyboard hook; pass tensorName to events tab)
- `frontend/src/styles.css` (badge styling)

## Sequencing

1. Store + persist + tests.
2. Shortcuts hook + tests.
3. EventTableView badge + counter + filter.
4. App.tsx wiring + manual smoke.
5. Commit.

Estimated effort: 2–3 hours.
