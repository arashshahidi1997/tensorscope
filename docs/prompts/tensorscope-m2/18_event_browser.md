# Prompt 18: Event Browser

Read first:

- [00_context.md](./00_context.md)
- [17_linked_crosshair.md](./17_linked_crosshair.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: create a proper event browser.

Scope:

- event stream listing
- event filtering
- click-to-navigate

Implementation Tasks:

- define the event-browser responsibilities inside the workspace shell
- specify filtering controls and result-list behavior
- define how event selection updates shared navigation state
- keep the browser compatible with current event stream APIs

Constraints:

- do not build a full analysis workflow here
- keep event browsing separate from peri-event visualization logic
- avoid duplicating event state in multiple disconnected stores

Acceptance Criteria:

- selecting an event updates shared navigation state
- filtering and stream selection are explicit
- the browser fits the existing shell and details-panel direction

Deliverables:

- prompt for a bounded event-browser implementation pass
- explicit selection and filtering contract
