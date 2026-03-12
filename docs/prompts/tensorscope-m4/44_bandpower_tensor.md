# Prompt 44: Band Power Tensor

This prompt is an instance of the shared frequency-domain derived tensor pattern.

Read [42_spectrogram_tensor.md](./42_spectrogram_tensor.md) first — it defines `BandPowerTransform` as a composition of `PSDTransform` + `BandSelectTransform` and establishes the shared STFT contract.

Band-power-specific constraints (on top of 42):

- band definitions (name, Hz range) are explicit `BandPowerTransform` parameters, not view-local constants; they travel with the derived tensor as provenance
- output coordinates are `(time, band, channel)` for temporal traces or `(band, AP, ML)` for spatial views — the consuming view selects the appropriate slice
- band power values that feed spatial views must be output as `Float32Array` (one value per channel per band) so they can be passed directly to deck.gl `ScatterplotLayer` attribute slots with no intermediate JS object allocation
- temporal aggregation window (e.g., 1s sliding window) must be an explicit parameter, not a hardcoded default
