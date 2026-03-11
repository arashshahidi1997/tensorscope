# Prompt 37: Spatial Event Views

Read first:

- [00_context.md](./00_context.md)
- [34_propagation_view.md](./34_propagation_view.md)
- [36_spatial_linking.md](./36_spatial_linking.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: support event-centered spatial visualization.

Scope:

- display propagation around selected event
- peri-event spatial heatmaps
- event navigation integration

Implementation Tasks:

- define how selected events drive spatial view windows
- specify peri-event spatial heatmap behavior
- describe how event navigation updates spatial context automatically
- keep the design compatible with shared event identity and time state

Constraints:

- do not create a separate event-navigation system for spatial views
- keep event-centered windows explicit and bounded
- preserve the CPU-first spatial path

Acceptance Criteria:

- selecting an event updates spatial views automatically
- peri-event spatial visualization rules are explicit
- event-centered spatial views align with shared navigation state

Deliverables:

- prompt-ready event-centered spatial-view spec
- explicit event-to-spatial-window contract
