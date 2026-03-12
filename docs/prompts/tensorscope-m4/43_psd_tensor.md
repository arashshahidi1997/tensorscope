# Prompt 43: PSD Tensor

This prompt is an instance of the shared frequency-domain derived tensor pattern.

Read [42_spectrogram_tensor.md](./42_spectrogram_tensor.md) first — it establishes the `SpectralTransformBase` and shared STFT contract that PSD builds on.

PSD-specific constraints (on top of 42):

- aggregate across time segments using Welch's method or equivalent; the aggregation method must be an explicit transform parameter
- output coordinates are `(freq, channel)` — time dimension is collapsed
- PSD tensors must be usable without a spectrogram: they register independently as `PSDTransform`, not as a derivative of `SpectrogramTransform`
- windowing assumptions (overlap, window function) must appear in `DerivedTensor.params`, not hardcoded in view logic
