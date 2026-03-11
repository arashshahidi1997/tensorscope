# Prompt 17: Linked Crosshair

Read first:

- [00_context.md](./00_context.md)
- [15_spectrogram_view.md](./15_spectrogram_view.md)
- [16_channel_grid_view.md](./16_channel_grid_view.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: implement cross-view cursor linking.

Scope:

- shared cursor state
- hover events
- crosshair overlay

Implementation Tasks:

- define the minimal shared cursor contract
- separate transient hover/cursor state from committed navigation state where needed
- specify overlay behavior for views that can render a crosshair
- keep the design compatible with timeseries, spectrogram, and channel-grid views

Constraints:

- do not wire views together directly
- avoid React rerender loops for hover-frequency updates
- keep cursor linking distinct from event selection and time-window changes

Acceptance Criteria:

- hover in one view updates cursor in others
- the crosshair contract is shared and explicit
- cursor updates remain lightweight enough for interactive use

Deliverables:

- prompt-ready linked-crosshair design
- bounded implementation target for one future agent run
