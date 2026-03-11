# Prompt 30: Spatial Layout Model

Read first:

- [00_context.md](./00_context.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)
- [../../architecture/invariants.md](../../architecture/invariants.md)

Goal: define a model for electrode spatial layouts.

Scope:

- AP/ML coordinates
- channel index mapping
- optional probe geometry

Implementation Tasks:

- define the minimum layout contract needed for spatial views
- specify how channel identifiers map to spatial coordinates
- allow extension for optional probe or array geometry
- keep the model compatible with shared navigation state and registry direction

Constraints:

- do not hardwire one probe geometry format as the only supported case
- do not embed rendering-specific assumptions into the layout model
- label new modules as planned if the task remains contract-first

Acceptance Criteria:

- `ChannelGridView` can render electrodes in correct spatial locations
- channel-to-coordinate mapping is explicit
- the model can extend to optional probe geometry later

Deliverables:

- scoped spatial-layout contract
- explicit mapping rules for channel identifiers and coordinates
