# Prompt 15: Spectrogram View

Read first:

- [00_context.md](./00_context.md)
- [12_data_source.md](./12_data_source.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: implement a proper `SpectrogramView` component.

Scope:

- FFT pipeline
- frequency axis mapping
- color scaling

Implementation Tasks:

- inspect the current spectrogram placeholder or prototype path
- define the data contract needed for spectrogram rendering
- specify how time window and frequency mapping interact with shared navigation state
- define the minimum color-scaling behavior needed for M2

Constraints:

- spectrogram rendering must integrate with shared navigation state
- do not push hot rendering updates through React rerender loops
- keep the first renderer CPU-first

Acceptance Criteria:

- spectrogram updates when time window changes
- axis mapping and color scaling are explicit
- the component fits the existing workspace-shell model

Deliverables:

- scoped prompt for a real spectrogram implementation pass
- explicit acceptance criteria tied to current TensorScope architecture
