---
title: "Expert review — backlog of smaller findings (not scheduled)"
date: 2026-05-02
timestamp: 20260502-140000-006
tags: [idea, review, backlog]
---

# Expert review — backlog (not scheduled)

Companion to the expert review at
`docs/log/idea/idea-arash-20260502-130000-expert-review.md`. The five
top-priority items have been promoted to task notes
(`task-probelayout-design-…`, `task-pipeline-spec-design-…`,
`task-paramspec-tristate-…`, `task-psd-fmin-log-freq-…`,
`task-triggered-baseline-…`).

Everything below is parked. Either it is subsumed by one of the
scheduled tasks (mostly the two design proposals), or it's a smaller
fix that's not worth scheduling until the architecture decisions above
have landed.

## Subsumed by `task-probelayout-design-…`

- **CMR over all channels is wrong for multi-shank / multi-region**
  recordings. Once `ProbeLayout` carries channel groups, CMR becomes
  per-group by default.
- **Channel show/hide, per-channel colour, anatomical group ordering**
  (NeuroScope2 staples). All fall out of channel-group metadata.
- **Region tagging on detected events** so the `EventTable` can filter
  by source region.
- **`(time, channel)` + per-channel coords** path in `_median_spatial_flat`
  becomes the general path; the AP/ML-as-dim path becomes a special
  case.

## Subsumed by `task-pipeline-spec-design-…`

- **Stable user-controlled tensor IDs** (vs auto `{name}_{uuid4[:8]}`).
- **DAG export/import** as JSON or YAML.
- **Stale-cache visibility** (badge derived tensors when their inputs
  changed).
- **Provenance → paper-ready captions** generator.
- **Wildcards / fan-out** over batches of sessions.

## Standalone smaller items (not yet scheduled)

These could become focused tasks later — none is blocking. Listed in
rough order of effort.

### Signal-processing

- **Sliding-window z-score** for visualization. Current `zscorex` uses
  the full recording; for sleep / anaesthesia transitions a 30-s
  sliding window is what neuroscientists actually want. Keep the
  global one for analysis output; add a `window_s` param for the
  sliding variant.
- **Spectrogram parameters DTO** mirroring `PsdParamsDTO` so a slice
  consumer can reproduce a paper figure (window length, overlap,
  taper bandwidth).
- **Notch frequency vs Nyquist guard** at the PUT
  `/api/v1/processing` handler. Today `notchesx` raises only at apply
  time when a harmonic exceeds Nyquist; the user discovers the bad
  config when they try to slice. Pre-validate against the dataset's
  `fs`.
- **Shoulder-controlled bandpass** option (cogpy already has
  `butterworth_bandpass_shoulder`). Better stopband control than the
  default Butterworth. Expose as a separate transform.
- **Adaptive-Q notch harmonics** — Q decays as you move up the
  harmonic series. Reduces ringing on high harmonics.

### Neuroscience

- **Demo dataset more representative.** 200 Hz / 8×8 / 6 s misleads
  contributors. Regenerate `data/demo_lfp.nc` at 1250 Hz, ~30 s, with
  an irregular probe geometry. Also makes `cogpy_ripple` smoke pass on
  the demo (today it fails on Nyquist).
- **Absolute-time semantics.** `xr.DataArray` time coords already
  support `np.datetime64`; pick a policy and document. Useful for
  chronic recordings and behavioural-camera sync.
- **Event-type vocabulary** — recommended tags (SWR, spindle,
  K-complex, gamma burst, etc.) so detectors and downstream code
  agree.
- **CSD heatmap view** for laminar work. New view type, consumes a
  laminar tensor, renders Δ²V/Δz² across depth.

### Big bets (not ready to schedule — need design discussion first)

- **Spike data integration.** Sparse event streams keyed to a channel
  group + cluster ID. Linked navigation: click a spike → centre
  timeseries. The single biggest functional gap vs NeuroScope2.
- **Behavioural / task data tracks.** Position, velocity, licks,
  rewards, opto pulses. Mixed continuous + categorical. Schema
  decision.
- **NeuroScope file-format compatibility** (`.xml`, `.res`, `.clu`,
  `.nrs` readers). Only worth doing if the project commits to being
  NeuroScope-compatible. Otherwise we ingest via NWB / SpikeInterface
  and skip the legacy path.

## How this list should be used

When a scheduled task lands and the design proposal it's part of (or
the surgical fix) is merged, walk this list and either:

1. Promote the now-actionable item to a task note (move it into
   `docs/log/issue/`), or
2. Delete the line — the item turned out to be subsumed cleanly by the
   landed work, or
3. Leave it parked with a note explaining what's still needed.

Don't let the list rot.
