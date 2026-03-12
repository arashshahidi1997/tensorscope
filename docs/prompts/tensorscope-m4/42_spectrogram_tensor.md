# Prompt 42: Frequency-Domain Derived Tensors

Read first:

- [00_context.md](./00_context.md)
- [40_transform_registry.md](./40_transform_registry.md)
- [41_derived_tensor_model.md](./41_derived_tensor_model.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: define the three frequency-domain derived tensors as registered transforms: spectrogram, PSD, and band power. These three share a common STFT/spectral computation backbone and differ only in how they aggregate the output. Specify them together to avoid contract drift.

Note: prompts 43 and 44 are instances of this pattern. Read this prompt first; 43 (PSD) and 44 (band power) add only aggregation-specific constraints on top of the shared contract defined here.

Scope:

- STFT computation contract shared across all three
- frequency coordinate definition (Hz, bin count, window semantics)
- time-frequency grid (spectrogram)
- frequency-domain aggregation (PSD: mean over time segments)
- band selection and temporal aggregation (band power: integrate over Hz range)

Implementation Tasks:

- define a shared `SpectralTransformBase` that specifies the STFT window, hop, and FFT parameters
- register `SpectrogramTransform`, `PSDTransform`, and `BandPowerTransform` as distinct registry entries that compose from `SpectralTransformBase`
- specify output tensor coordinates for each: spectrogram → `(time, freq, channel)`, PSD → `(freq, channel)`, band power → `(time, band, channel)` or `(band, AP, ML)` for spatial views
- keep band definitions as explicit transform parameters, not view-local constants
- confirm each output is a first-class derived tensor compatible with the view registry

Constraints:

- use worker-based computation for STFT (see `48_computation_workers.md`)
- views consume these tensors; they do not compute spectra inline
- keep time-frequency semantics explicit and coordinate-aligned with the input tensor's time axis
- band definitions must travel with the band-power tensor as provenance, not only with the view

Acceptance Criteria:

- `SpectrogramView`, `PSDView`, and `SpatialMapView` each consume the correct derived tensor type
- STFT, windowing, and aggregation parameters are explicit in each transform's registration
- band definitions are part of `BandPowerTransform` provenance, not hidden in view state
- all three outputs satisfy the `Trackable` contract from `41_derived_tensor_model.md`

Deliverables:

- prompt-ready specs for all three frequency-domain derived tensors
- explicit shared STFT contract + per-tensor aggregation rules

## Reference

Observable Plot's `composeTransform` pattern from `40_transform_registry.md` is directly applicable: `BandPowerTransform = composeTransform(PSDTransform, BandSelectTransform)`. PSD and band selection remain individually reusable; the composition records its provenance chain.

The spectrogram view currently renders from raw server data via Canvas 2D. The Perspective `draw()` / `update()` split applies here: the initial `draw()` sets up the frequency axis and colormap scale; subsequent `update()` calls append new time slices without rebuilding the colormap. Do not rebuild the full canvas on every time-window pan — only update the newly visible time range.

See [docs/reference-studies/perspective.md §2d](../../reference-studies/perspective.md).

For band-power tensors feeding the spatial electrode map: the output `Float32Array` (one value per channel) should be passed directly to the deck.gl `ScatterplotLayer` `getFillColor` attribute slot. Specify `DerivedTensor.outputSchema.dtype = 'float32'` for these tensors.

See [docs/reference-studies/deck-gl.md §2.7](../../reference-studies/deck-gl.md).
