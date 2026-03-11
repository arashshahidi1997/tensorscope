# Prompt 13: LOD Pipeline

Read first:

- [00_context.md](./00_context.md)
- [12_data_source.md](./12_data_source.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: introduce multiresolution pyramids for time-series data.

Scope:

- decimation levels
- LOD switching
- window-based aggregation

Implementation Tasks:

- define the LOD levels needed for overview and detail rendering
- describe how visible window size chooses an LOD level
- define the aggregation contract for decimated windows
- keep the pipeline compatible with async slice requests

Constraints:

- do not bind the design to one renderer
- do not assume GPU acceleration
- keep the first version time-series focused

Acceptance Criteria:

- large recordings can render overview quickly
- LOD switching rules are explicit
- the pipeline can support current `uPlot`-based views

Deliverables:

- prompt-ready LOD design
- clear acceptance targets for an implementation pass
