---
title: "Design proposal: ProbeLayout / channel-group metadata model"
status: done
result_note: /storage2/arash/worklog/workflow/captures/20260502-171035-4f1f5e/note.md
completed: 2026-05-02T17:10:37+02:00
created: 2026-05-02
updated: 2026-05-02
timestamp: 20260502-140000-001
tags: [task, design, architecture, probe, channels]
---

# Design proposal: ProbeLayout / channel-group metadata

**Output is a design document, not code.** Do not modify production code
in this task.

## Why

TensorScope hard-codes a `(time, AP, ML)` 2-D grid layout in many places
(`server/state.py`, `apply_processing`, `cmrx` auto-detection, view code,
slice request DTOs). The expert review at
`docs/log/idea/idea-arash-20260502-130000-expert-review.md` documents
why this blocks real probe types:

- Tetrodes: `(time, shank, channel-on-shank)`
- Neuropixels: `(time, depth)` or `(time, shank, depth)`
- Laminar electrodes: `(time, depth)` only
- Heterogeneous multi-region: flat channel list with per-channel metadata

The current `(time, channel)` + per-channel `AP/ML` coords path
(`_median_spatial_flat` in `state.py`) is a one-off workaround for the
spatial-median transform — it doesn't generalize.

A second consequence: CMR currently medians over **all channels**
(`cogpy.preprocess.filtering.reference.cmrx`). For multi-shank /
multi-region recordings this is wrong — referencing a CA1 channel
against a cortex channel injects cross-region structure.

## What to deliver

A markdown design proposal at
`docs/design/probe-layout.md` covering:

1. **Data model** — what does a `ProbeLayout` carry?
   - Electrode geometry (positions in 2D or 3D)
   - Channel groups (region, shank, anatomy, colour) with hierarchy
   - Sample rate per group (LFP vs spike-band can differ)
   - Reference scheme spec (which channels CMR together)

2. **Schema** — where does it live?
   - Attached to the `xr.DataArray` as attrs / accessor?
   - Separate sidecar object stored on `ServerState`?
   - Compatibility with `xr.Dataset` if more than one tensor shares it

3. **Migration path** — how do existing `(time, AP, ML)` datasets keep
   working? Auto-derive a default ProbeLayout from AP/ML coords; let
   users override.

4. **Impact list** — for each surface, sketch what changes:
   - `apply_slice_request` / `apply_processing` in `server/state.py`
   - `cmrx` channel-dim selection (per-group instead of global)
   - View descriptors (`spatial_map`, `psd_spatial`, `propagation_frame`)
   - DTOs: do `SelectionDTO.ap` / `ml` become `channel_id`?
   - Frontend: does the view registry read group metadata?

5. **NeuroScope2 alignment** — call out which NeuroScope2 features fall
   out of this for free (channel show/hide, per-group colour,
   anatomical ordering, per-region CMR).

6. **Out-of-scope** — explicitly list what this proposal does NOT
   address (spike data integration, file-format readers, behavioural
   tracks). These are separate decisions.

7. **Recommendation** — pick one approach. Do not enumerate options
   without committing to a preferred path. Estimate effort
   (surgical / multi-week / multi-month).

## Process

- Read the expert review note in full
- Skim every file under `src/tensorscope/server/` and
  `src/tensorscope/core/` that mentions `AP` or `ML`
- Look at how `cogpy` represents channel metadata in
  `/storage2/arash/projects/cogpy/src/cogpy/` — reuse where it fits
- Look at NWB / SpikeInterface probe representations for prior art
- Estimate ~3–4 hours of reading + writing. Do not exceed that.

## Constraints

- Output is one markdown document. No code changes.
- Do not start implementing. The point of this task is to give the user
  a decision-ready proposal they can approve, modify, or reject.
- If you find a design choice you cannot make without the user's input,
  list it in a `## Open questions` section at the end.
