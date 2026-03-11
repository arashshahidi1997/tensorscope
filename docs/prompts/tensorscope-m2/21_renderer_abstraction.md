# Prompt 21: Renderer Abstraction

Read first:

- [00_context.md](./00_context.md)
- [20_spatial_propagation.md](./20_spatial_propagation.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: introduce renderer abstraction.

Scope:

- Canvas renderer
- future WebGL renderer
- render pipeline separation

Implementation Tasks:

- define the minimum renderer interface required by M2 scientific views
- separate view logic from rendering backend concerns
- document how a CPU Canvas path remains primary while a future WebGL path stays optional
- keep the abstraction narrow enough to support current needs

Constraints:

- do not abstract away view semantics into a generic graphics framework
- do not make WebGL a prerequisite for M2
- keep current `uPlot` usage compatible with the architecture

Acceptance Criteria:

- views are decoupled from rendering backend
- Canvas can serve as the first renderer path
- future WebGL work can slot in without rewriting view semantics

Deliverables:

- prompt-ready renderer abstraction spec
- bounded implementation target for a future agent pass
