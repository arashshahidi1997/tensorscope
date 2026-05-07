---
title: "Design proposal: declarative pipeline spec + persistent cache"
status: done
result_note: /storage2/arash/worklog/workflow/captures/20260502-171436-f8ff5e/note.md
completed: 2026-05-02T17:14:37+02:00
created: 2026-05-02
updated: 2026-05-02
timestamp: 20260502-140000-002
tags: [task, design, architecture, pipeline, cache, snakemake]
---

# Design proposal: declarative pipeline spec + persistent cache

**Output is a design document, not code.**

## Why

TensorScope's transform DAG is built imperatively through the UI:
`POST /api/v1/transforms/execute` accumulates `DerivedTensor`s in a
session-scoped cache (`_processed_cache` and `TransformCache` in
`src/tensorscope/core/transforms/`). When the server stops, every
derived tensor is gone — including expensive multitaper PSDs that took
minutes to compute.

There is no way to:

- Hand a colleague a pipeline spec and reproduce the same derived
  tensors.
- Re-run a saved analysis when raw data changes.
- Run the same pipeline over a batch of sessions (no wildcards / fan-
  out).
- Export / import a DAG, version-control it, or diff it.
- See which derived tensors are stale because their inputs changed.

The expert review note at
`docs/log/idea/idea-arash-20260502-130000-expert-review.md` frames this
through the snakemake lens.

## What to deliver

A design proposal at `docs/design/pipeline-spec.md` covering:

1. **Spec format** — propose `pipeline.yaml` (or `tensorscope.smk`)
   that the UI reads and writes.
   - Schema: tensors, transforms, params, dependencies, output IDs
   - Mirror snakemake conventions (rules, wildcards, input/output) where
     it doesn't fight TensorScope's per-session model
   - Round-trip with the in-memory DAG: load YAML → seed DAG; export
     DAG → write YAML

2. **Persistent cache** — design the on-disk layout under
   `.tensorscope-cache/`:
   - One directory per cache_key, holding a `.zarr` store + provenance
     JSON (zarr is already a project dep via `ecogpy[io]`)
   - mtime-based invalidation against the source `.nc` file (snakemake
     style)
   - Migration: existing in-memory cache becomes a write-through layer
     above the disk cache

3. **Stale-cache visibility** — how does the user see what's stale?
   - Badge on derived tensors in the DAG view
   - `tensorscope cache status` CLI / `GET /api/v1/cache/status` that
     returns the list of stale entries

4. **Wildcards / fan-out** — how do we handle "run this DAG over 30
   sessions"?
   - Option A: keep visualization single-session, push batch to a CLI
     (`tensorscope batch run pipeline.yaml --sessions ...`)
   - Option B: add `dispatch_over=` to transform requests and let the
     server orchestrate
   - Recommend one. Don't enumerate without committing.

5. **Stable IDs** — `tensor_id` defaults to
   `{transform_name}_{uuid4[:8]}`. For reproducibility (papers, tests),
   user-controlled stable IDs from `pipeline.yaml` should win. Sketch
   the precedence rules.

6. **Provenance → captions** — once persistent, the cache directory can
   render paper-ready figure captions from `provenance.params`. Sketch
   the format ("Multitaper PSD, NW=3, K=5, 1–80 Hz, after notch 50 Hz
   Q=30, …").

7. **Out-of-scope** — explicitly call out:
   - Distributed execution (single machine for now)
   - Non-tensor outputs (figures, reports — separate concern)
   - Cluster / HPC integration

8. **Recommendation** — pick one path. Estimate effort.

## Process

- Read the expert review note (snakemake section)
- Read `src/tensorscope/core/transforms/cache.py`, `dag.py`, `executor.py`
- Read `src/tensorscope/server/state.py` `_processed_cache` logic
- Look at how snakemake represents DAGs (Snakefile, `--dag` JSON output)
- Look at zarr layouts in cogpy (already used for I/O)
- ~3–4 hours of reading + writing. No code changes.

## Constraints

- Output is one markdown design doc.
- Do not start implementing.
- If a design choice needs the user's input, file it under
  `## Open questions` at the end.
