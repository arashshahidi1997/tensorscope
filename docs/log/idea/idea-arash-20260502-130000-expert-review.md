---
title: "Expert review: SP / neuroscience / snakemake + neuroscope2 lenses"
date: 2026-05-02
timestamp: 20260502-130000-001
tags: [idea, review, ux, signal-processing, neuroscience, pipeline]
---

# Expert review of TensorScope — three lenses

Captured after the cogpy-integration smoke sweep on 2026-04-23. Grounded
in the current code (commit `e340dc6` and earlier). Purpose: surface gaps
that are not obvious from the milestone-status logs.

The same observation can show up under more than one lens; I've tried to
list each item exactly once under its primary frame.

---

## 1. Signal-processing expert lens

### Multitaper PSD

- `PsdParamsDTO.K` is `int` with sentinel `0` → "auto". The "auto" rule
  most users expect is `K = floor(2·NW − 1)`. The DTO should accept
  `int | None` and document the fallback. The `0` sentinel leaks into
  `param_schema` JSON and the OpenAPI contract — confusing for clients
  that aren't tensorscope's own UI.
- Same for `fmax = 0` meaning "Nyquist" and `noverlap = -1` for
  `psd_welch`. The agent flagged this in the task note as a workaround
  for `ParamSpec(default=None)` meaning "required". The fix is in
  `core/transforms/registry.py` (let `ParamSpec` carry a tri-state
  required vs default-None vs default-value), not in every wrapper.
- `fmin` default `0.0` puts a DC bin into all PSD plots. For LFP the
  conventional floor is 0.5–1 Hz; the bin at 0 dominates dynamic range
  and the log-display loses the alpha/beta band visually. Recommend
  default `fmin=1.0` and a clear "Show DC" toggle.

### Filters (cogpy-backed)

- `bandpassx` and `notchesx` are zero-phase (`sosfiltfilt` / `filtfilt`).
  Good — this is the right choice for offline analysis.
- Butterworth order 4 is exposed and clamped 1–8. Fine. There's no
  shoulder-controlled bandpass option (cogpy has
  `butterworth_bandpass_shoulder`); for tight transition bands it would
  give better stopband control.
- `notchesx` raises if any notch freq is ≥ Nyquist. The current DTO
  builds harmonics as `notch_freq * (i+1)` for `i in range(harmonics)`.
  At 200 Hz demo fs and `notch_freq=50, harmonics=3` this would request
  150 Hz — ok at Nyquist=100 Hz it would still raise. There's no
  client-side guard that compares against the dataset's fs; bad UX to
  fail at apply-time. Pre-validate against fs in the PUT handler.
- IIR notches at higher harmonics ring more than people realise; for
  60-Hz US power harmonics this is not visible by eye but it pollutes
  the broad-band envelope. Worth offering a "strict" mode that uses
  iirnotch with adaptive Q per harmonic (Q decays).

### Common median reference

- `cmrx` auto-detects AP/ML and reduces over **all channels**. This is
  correct for a single Utah-style array and matches NeuroScope2's
  `traces - median(traces, 2)`. It is **wrong** for multi-shank /
  multi-region recordings where you want CMR per shank, per region, or
  per probe — referencing a CA1 channel against a cortex channel injects
  cross-region structure.
- The fix is upstream in tensorscope's data model: a "channel group"
  concept (see neuroscience lens). Until then, expose `channel_dims=` to
  the UI so users can opt in to AP-only or ML-only median.

### Z-score

- `zscorex(out, dim="time", robust=...)` uses the **whole recording** to
  compute mean/SD. For sleep recordings or anaesthetic-transition data
  this conflates regimes — REM has higher theta variance than NREM, so a
  global z-score under-amplifies REM structure. NeuroScope-style sliding
  z-score (window ~30 s) is what's usually wanted for visualization;
  keep the global one for analysis output.

### Triggered statistics

- `triggered_average` consumes `(event, …, lag)` epochs from
  `perievent_epochs`. There is no baseline correction (subtract pre-event
  mean per epoch). For ERP-style work the average is dominated by the
  pre-event DC offset across epochs. Add a `baseline_window=(t0, t1)`
  param that subtracts mean over that lag interval.
- `triggered_snr` should declare what it computes — peak/rms? pre/post
  ratio? The wrapper documentation in `transforms/builtins.py` is
  thinner than the rest.

### Spectrogram

- The spectrogram view exists but the multitaper STFT params (window,
  overlap, NW) are not exposed on the slice DTO — slice consumers can't
  reproduce a paper figure. Mirror the `PsdParamsDTO` pattern with a
  `SpectrogramParamsDTO`.

### Frequency-axis display

- All PSD/spectrogram views render linear-frequency by default.
  Convention in EEG/LFP work is log-frequency (decade per octave). Add
  a per-view `freq_scale: "linear" | "log"` toggle; cheap on the
  frontend.

### Missing: spike-band processing

- TensorScope is purely an LFP/tensor viewer. There is no high-pass +
  CMR + threshold pipeline for spike-band MUA. cogpy doesn't ship one
  either, but the gap is worth marking — most labs that have LFP also
  have spike-band data and want to see them together.

---

## 2. Neuroscientist lens

### Probe / channel model is rigid

- `data` is a `(time, AP, ML)` xarray. AP/ML is a **2-D Utah-array** or
  **µECoG-grid** assumption. Real-world probes:
  - Tetrodes: `(time, shank, channel-on-shank)`
  - Neuropixels: `(time, depth)` with optional `(time, shank, depth)`
  - Laminar: `(time, depth)` only — no AP/ML at all
  - Multi-region heterogeneous: a flat channel list with metadata
- The `(time, channel)` + per-channel `AP/ML` coords path
  (`_median_spatial_flat` in `state.py`) is a workaround for irregular
  geometries, but it only kicks in for spatial median. Most other code
  paths assume AP/ML are dimensions.
- Recommendation: introduce a `ProbeLayout` metadata object that owns
  electrode geometry, channel groups, regions, shank IDs. View
  selection uses it instead of hard-coded `AP/ML`. This unblocks
  tetrodes, Neuropixels, ECoG strips, and depth electrodes.

### Channel groups / region labels

- Nothing in the schema lets you say "channels 0–7 are CA1, 8–15 are
  cortex". NeuroScope2's anatomical groups (with per-group color, show
  /hide, default ordering) are a load-bearing feature. Without them you
  cannot:
  - colour traces by region in the timeseries view
  - reduce/CMR per region
  - tag detected events with their source region
  - filter EventTable by region

### No spike data

- TensorScope has no spike track. Real LFP analysis is rarely done in
  isolation from spike rasters: ripple-spike coupling, theta phase
  locking, MUA bursts, replay analyses. The data model would need to
  hold sparse event times keyed to a channel group + cluster ID. This
  is the single biggest functional gap vs NeuroScope2.

### No behavioural / task data

- Position, velocity, licks, rewards, opto pulses — none of these have
  a place in the current schema. They are conceptually `EventStream`s
  but with continuous values (position) or distinct categories (trial
  type, drug dose). Until they're first-class, all neuroscience
  analyses that need behaviour are off the table.

### Sampling rates and demo data

- Demo `data/demo_lfp.nc` is 200 Hz, 6 s, 8×8 grid. Real LFP files are
  1000–2500 Hz; spike-band 20–30 kHz; ECoG/iEEG 500 Hz–2 kHz. The 200 Hz
  demo trips the `cogpy_ripple` defaults (100–250 Hz exceeds Nyquist).
  Users running on real data won't see this, but new contributors form
  wrong intuitions about typical defaults. Replace the demo with a 1250
  Hz 30-second snippet — uses the same generator with different params.

### Time semantics

- All times are seconds-from-start of the loaded array. For chronic
  recordings, multi-session work, or syncing to behavioural cameras you
  need absolute time (Unix timestamp or wall-clock with an offset).
  `xr.DataArray` time coords already support `np.datetime64` — pick a
  policy and document it.

### Event-type vocabulary

- The `EventStream` model is generic and that's deliberate. But specific
  types matter for analysis: SWR, spindle, K-complex, slow-osc trough,
  theta cycle, gamma burst, MUA burst, behavioural trigger. Worth a
  recommended-tag taxonomy in the docs so detectors and downstream code
  agree (`event.type` field convention).

### CSD / ICA / spatial decomposition

- For laminar work, current source density (CSD) and ICA are
  bread-and-butter. cogpy doesn't ship these either, but tensorscope's
  view layer would benefit from a CSD-style heatmap view.

### Brainstates: positive

- Hypnogram + brainstate overlay on timeseries/navigator + intervals
  API is genuinely well-shaped and matches how sleep neuroscientists
  reason about data. Good prior art.

---

## 3. Snakemake / NeuroScope2 lens

### Pipelines aren't declarative

- The transform DAG is built imperatively through the UI:
  `POST /api/v1/transforms/execute` accumulates derived tensors. There
  is no on-disk pipeline spec.
- A user cannot:
  - Open a YAML/JSON file that says "for these 12 sessions, apply
    notch → bandpass → CMR → multitaper → SWR detector → triggered
    average". (Snakemake's bread and butter.)
  - Hand the same pipeline to a colleague and expect the same derived
    tensors.
  - Re-run a saved analysis from scratch when the upstream raw file
    changes.
- Recommendation: add `pipeline.yaml` (or `tensorscope.smk`) that the UI
  reads and writes. Schema mirrors the DAG; cache keys come from
  content hashing as today.

### Cache is in-memory, per-session

- `_processed_cache` and the `TransformCache` live on the server
  process. Quitting `pixi run serve` discards every derived tensor. For
  big multitapers this is minutes of compute thrown away.
- Recommendation: persistent cache under
  `.tensorscope-cache/{cache_key}.zarr` (already a project dependency).
  Snakemake-style mtime invalidation against the source file.

### No wildcards / fan-out

- Snakemake's strength is `for session in sessions: …`. TensorScope has
  no analogue. To run the same DAG over 30 recordings you script around
  the API. Fine for now, but it caps the tool at single-session
  exploration. Promoting batch is a real product question — keep
  visualization focused, push batch to a CLI, or reuse the DAG and
  expose a `dispatch_over=` parameter on transform requests.

### Pipeline export / import

- DAG is in memory. There is `GET /api/v1/dag` that returns the current
  graph but no `POST` to reconstruct one from JSON. Export-import is
  the prereq for sharing analyses, regression tests on pipelines, and
  CI for derived-tensor stability.

> **Shipped 2026-05-07** (commit `7884a88`). `POST /api/v1/pipeline/serialize?fmt=yaml|json` returns a downloadable file; `POST /api/v1/pipeline/import` parses YAML/JSON and replays via `core/pipeline/replay.replay_pipeline` against the session's transform executor with stable user-controlled tensor IDs. Frontend Pipeline tab gained an Export/Import section. Persistent cache, wildcard fan-out, and stale-cache visibility (other items in §3) intentionally deferred.

### Stable IDs

- `tensor_id` defaults to `{transform_name}_{uuid4[:8]}`. For
  reproducibility (papers, tests) you need stable, user-controlled
  IDs. The argument exists in the DTO but the UI never sets it. A
  pipeline.yaml would naturally carry these.

### NeuroScope2 features missing

NeuroScope / NeuroScope2 set the bar for LFP visualization in the
Buzsáki ecosystem. Concrete gaps:

- Channel show/hide and per-channel colour
- Anatomical group ordering (CA1 ▸ DG ▸ CTX) with collapsible groups
- Spike raster overlay synced to LFP scroll
- `.xml` session config (NeuroScope's metadata file) — channel layout,
  fs, anatomical groups, spike groups
- `.res` / `.clu` / `.nrs` file readers (or at least an importer)
- Click-to-jump-to-cluster, click-to-jump-to-event
- Annotations layer (free-text labels at timestamps)

These aren't all worth shipping. The first three are; the file-format
ones make sense only if the project commits to being NeuroScope-
compatible. That's a strategy decision.

### Provenance ↔ paper figures

- `DerivedTensor.provenance` stores transform name + params + parent
  IDs. Excellent foundation. What's missing: rendering provenance into
  paper-ready captions ("Multitaper PSD, NW=3, K=5, 1–80 Hz, after
  notch 50 Hz Q=30, bandpass 1–250 Hz order 4, CMR over (AP, ML).").
  Once on disk in the cache directory, a `tensorscope provenance
  --tensor-id X` command writes that paragraph for free.

### No invalidation visibility

- If raw data changes, every cached derived tensor downstream is now
  stale. The user has no way to see this. Snakemake makes invalidation
  visible (`-n -p` dry run shows every rule that would re-run). Even a
  greyed-out "stale" badge on derived tensors in the DAG view would
  help.

---

## Cross-cutting top-five (if you only fix five things)

1. Replace AP/ML hard-coding with a `ProbeLayout` + channel-group
   metadata object. Unblocks neuroscience use cases and per-region CMR.
2. Add a `pipeline.yaml` spec the UI reads/writes; persist the
   transform cache to disk under `.tensorscope-cache/`.
   *(Half shipped 2026-05-07 in `7884a88`: YAML/JSON round-trip via
   `/pipeline/serialize` + `/pipeline/import` with stable tensor IDs.
   Persistent cache deferred.)*
3. Fix the `K=0` / `fmax=0` / `noverlap=-1` sentinel leak by extending
   `ParamSpec` to a tri-state (required / default-None / default-value).
4. Default `fmin` to 1 Hz (not 0) and add `freq_scale: log|linear` to
   PSD/spectrogram views.
5. Add baseline correction to triggered-average and document what
   `triggered_snr` actually computes.

The bigger longer-term bets are spike-track integration and pipeline
reproducibility (snakemake-style). Both are significant scope; flag for
roadmap, don't try to land in the M9–M10 cycle.
