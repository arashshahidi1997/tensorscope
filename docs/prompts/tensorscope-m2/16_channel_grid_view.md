# Prompt 16: Channel Grid View

Read first:

- [00_context.md](./00_context.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)
- [../context_snapshot.md](../context_snapshot.md)

Goal: introduce a spatial `ChannelGridView`.

Scope:

- 2D grid layout
- mapping channels to AP/ML coordinates
- hover and selection linking

Implementation Tasks:

- define the view contract for spatial channel layout
- specify how channel metadata maps into AP/ML coordinates
- define hover and selection interactions through shared navigation state
- keep the first version aligned with the existing spatial-map direction

Constraints:

- do not make the grid view call trace views directly
- keep hover state lightweight
- label planned coordinate-mapping modules as planned if they do not exist yet

Acceptance Criteria:

- hover grid highlights corresponding trace
- grid selection uses shared navigation state
- the view contract fits the current workspace and registry direction

Deliverables:

- focused prompt for spatial grid implementation
- explicit state and interaction expectations
