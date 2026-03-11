# Prompt 19: Peri-Event Views

Read first:

- [00_context.md](./00_context.md)
- [18_event_browser.md](./18_event_browser.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: support peri-event aligned visualizations.

Scope:

- window extraction
- event-aligned traces
- comparison between events

Implementation Tasks:

- define the data contract for peri-event window extraction
- specify how selected events produce aligned trace windows
- define the minimum comparison behavior for multiple events
- keep the first version compatible with current shared navigation state

Constraints:

- do not mix peri-event alignment with propagation rendering in one step
- keep event alignment semantics explicit
- avoid forcing full-recording loads for each event interaction

Acceptance Criteria:

- multiple events can be browsed interactively
- aligned windows are defined by an explicit contract
- peri-event views integrate with the event browser and shared state

Deliverables:

- focused prompt for peri-event view implementation
- clear extraction and interaction boundaries
