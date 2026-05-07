# Design proposal: declarative pipeline spec + persistent cache

**Status:** proposal — no code changes here.
**Author:** agent (`task-pipeline-spec-design-20260502-140000-002`).
**Companion:** `docs/log/idea/idea-arash-20260502-130000-expert-review.md` (snakemake lens).

## 1. Why now

TensorScope's transform DAG is built imperatively through the UI:
`POST /api/v1/transforms/execute` accumulates `DerivedTensor`s in a
session-scoped cache (`TransformCache` in `core/transforms/cache.py` — pure
in-memory dict, 128 entries, LRU on insert) plus the server-side
`_processed_cache` in `server/state.py` (full-tensor processing pipeline,
cleared whenever `ProcessingParamsDTO` changes). The DAG itself
(`core/transforms/dag.py`) is round-trippable via `to_dict` / `from_dict`,
but nothing on disk uses it: stop the server and minutes of multitaper
compute is gone.

Concrete things a user cannot do today:

1. Hand a colleague `pipeline.yaml` and reproduce the same derived tensors.
2. Re-run a saved analysis when the raw `.nc` file changes.
3. Apply the same DAG to a batch of recordings.
4. Export / version-control / diff a DAG.
5. See which derived tensors are now stale because their inputs changed.

The recommendation in this doc lands all five as a single design, scoped
to single-machine, single-tenant TensorScope. It does **not** turn
TensorScope into a workflow engine — it adopts only the snakemake ideas
that fit a per-session interactive viewer.

## 2. Recommendation in one paragraph

Add a `pipeline.yaml` spec format that round-trips with `WorkspaceDAG`.
Persist `DerivedTensor`s to `.tensorscope-cache/<cache_key>/` (zarr +
provenance JSON), with `TransformCache` becoming a write-through layer
above disk. Invalidate by mtime against the source `.nc` file, plus
content-hash of the provenance chain (already computed). Surface
staleness as a per-tensor flag in `GET /api/v1/dag` and a new
`GET /api/v1/cache/status`. Promote `tensor_id` from
`{transform}_{uuid4[:8]}` to user-controlled stable IDs sourced from the
yaml. Push fan-out to a `tensorscope batch run pipeline.yaml` CLI rather
than complicating the per-session API. Estimated effort: ~3 weeks for a
single contributor (M9), with persistent cache as the load-bearing part
and the rest as a thin layer on top.

## 3. Spec format: `pipeline.yaml`

A single YAML file at the project root or alongside the dataset. The
schema is the smallest thing that round-trips with `WorkspaceDAG.to_dict`
plus enough sugar to be writable by hand.

### 3.1 Schema sketch

```yaml
# pipeline.yaml
version: 1
name: sleep-swr-baseline
description: |
  Notch + bandpass + CMR, then triggered average around SWRs.
  Reproducing fig 3 of the 2026 sleep paper.

# Inputs are declared, not discovered. Each input is a logical name
# pointing at a data location (path on disk for now; URI in future).
inputs:
  lfp:
    path: data/sub-01_ses-01_lfp.nc
    tensor: lfp        # name of the xr.DataArray inside the netCDF
                       # (omit if the file holds a single array)

# Transforms produce derived tensors. ID on the left is the stable
# tensor_id (used by the viewer, the cache key, captions, citations).
transforms:
  lfp_notched:
    transform: notch
    inputs: [lfp]
    params:
      notch_freq: 50.0
      harmonics: 3
      Q: 30

  lfp_filtered:
    transform: bandpass
    inputs: [lfp_notched]
    params:
      lowcut: 1.0
      highcut: 250.0
      order: 4

  lfp_cmr:
    transform: cmr
    inputs: [lfp_filtered]
    params:
      channel_dims: [AP, ML]   # see expert-review note §1; opt-in CMR scope

  swr_events:
    transform: cogpy_ripple
    inputs: [lfp_cmr]
    params:
      low_threshold_sd: 2.0
      high_threshold_sd: 5.0

  swr_epochs:
    transform: perievent_epochs
    inputs: [lfp_cmr, swr_events]
    params:
      lag_window: [-0.5, 0.5]

  swr_avg:
    transform: triggered_average
    inputs: [swr_epochs]
    params:
      baseline_window: [-0.5, -0.2]   # see expert-review §1, ERP baseline

# Outputs are tensors the user wants persisted/visible. Anything
# computed but not listed here is exploratory (DAG node
# exploratory=True; not eligible for figure export). Mirrors the
# existing pipeline_selected flag on DAGTensorNode.
outputs:
  - swr_avg
  - swr_events

# Optional: views the UI should restore on load. Not load-bearing for
# reproducibility; convenience only.
workspace:
  active_views: [timeseries, swr_avg_curve]
  layout_preset: triggered-average
```

### 3.2 What the schema is **not**

- Not a Snakefile. No rule wildcards, no shell, no resource directives.
  The wildcard story lives in the batch CLI (§7).
- Not a session dump. Selection state, time windows, brainstate filters,
  view settings stay in the session cookie. `pipeline.yaml` describes
  *what to compute*, not *what to look at right now*.
- Not a config file for the server. `processing` (the pre-DAG
  notch/bandpass/CMR/zscore pipeline in `apply_processing`) is
  represented as ordinary transform nodes in the YAML; the imperative
  `ProcessingParamsDTO` becomes a UI shortcut that emits four DAG nodes
  rather than a parallel mechanism.

### 3.3 Round-trip with `WorkspaceDAG`

```
pipeline.yaml ──load──▶ WorkspaceDAG (+TensorRegistry placeholders)
WorkspaceDAG ──export──▶ pipeline.yaml
```

- `load`: walk `transforms` in topological order; for each entry call
  `TransformExecutor.execute(transform_name, input_names, params,
  tensor_id=<yaml key>)`. Inputs from `inputs:` are loaded as source
  `TensorNode`s before any transform runs. The user explicitly chooses
  whether to *materialize* on load (run everything now) or *seed*
  (register nodes, mark `status="pending"`, compute lazily on first view
  request — matches today's per-view fetch pattern).
- `export`: for every transform node in the DAG, emit one `transforms:`
  entry. The yaml key is the output tensor's `tensor_id`. Inputs are
  the upstream tensor IDs from `dag.get_direct_inputs`. Params are the
  already-validated `DAGTransformNode.params`. Source tensors with
  unknown disk locations export as `inputs.<name>: {path: <unset>}` and
  raise a warning.
- Source-of-truth rule: when both DAG and yaml exist (mid-session), the
  in-memory DAG wins; export is the only writer to yaml. The UI offers
  a single "export pipeline" action; reload means reading the yaml back.
- Schema validation lives next to `core/transforms/registry.py`: each
  transform's `param_schema` is already a `dict[str, ParamSpec]`; reuse
  `validate_params` against the yaml `params:` block.

### 3.4 Why YAML, not Snakefile

A Snakefile is a Python program. Sourcing one in tensorscope means
shipping a snakemake parser or shelling out — both are heavier than the
problem. YAML is what the existing `to_dict`/`from_dict` round-trip
already produces in everything but syntax. The cost of "looks less like
snakemake" is small relative to "no Python execution model in the
viewer."

If snakemake interop ever becomes a goal (e.g. tensorscope embedded as
a step in a lab pipeline), a thin `tensorscope export --snakemake` that
emits a Snakefile from the same YAML is straightforward and isolates
the dependency. **Out of scope here** — flagged for later.

## 4. Persistent cache

### 4.1 On-disk layout

```
.tensorscope-cache/
├── index.json                       # cache_key → metadata, pruning stats
├── source-fingerprints.json         # path → (mtime, size, content-hash)
└── <cache_key>/
    ├── data.zarr/                   # the DerivedTensor payload
    ├── provenance.json              # TransformProvenance.to_dict()
    └── meta.json                    # dims, shape, dtype, coord summary,
                                     # source_fingerprints, cogpy/tensorscope
                                     # versions, created_at, last_used_at
```

- `cache_key` is `TransformProvenance.cache_key()` — sha256 over canonical
  JSON of `(transform_name, params, parent_ids)`. Already implemented in
  `core/transforms/model.py` and good enough as a content hash.
- One zarr store per derived tensor. Zarr is already a project dep via
  `ecogpy[io]`; cogpy uses it for I/O elsewhere. Avoids inventing a new
  format and gives chunked random-access reads (matters for 10–100 GB
  spectrograms that the slice API will eventually want to mmap).
- `source-fingerprints.json` is the snakemake equivalent of
  `--touch-changes`. We track the source `.nc` files referenced by the
  yaml `inputs:` block. A change in mtime *or* size *or* (optional, lazy)
  content hash invalidates every downstream cache_key.
- `index.json` is a flat lookup so we can answer `cache/status` without
  walking the directory tree.

### 4.2 Write-through layer

`TransformCache` becomes a façade with two tiers:

```
get(cache_key):
    1. memory dict hit → return
    2. disk hit → hydrate DerivedTensor (lazy zarr open), promote to
       memory, return
    3. miss → return None

put(tensor):
    1. write zarr + provenance.json + meta.json under cache_key/
    2. update index.json (atomic via write-rename)
    3. memory dict insert, evict oldest if > max_entries
```

- "Hydrate" returns a `DerivedTensor` whose `.data` is an
  `xr.open_zarr(..., chunks="auto")` lazy-loaded array. The slice path
  in `apply_slice_request` already calls `.sel(...)` on `xr.DataArray`,
  which is dask-aware. No code change in the slice path other than not
  assuming the array is fully realized in RAM.
- Eviction policy: memory tier keeps LRU as today; disk tier is
  unbounded by default with an opt-in `max_disk_gb` setting. Disk
  pruning is manual (`tensorscope cache clean`) until size becomes a
  real problem.
- Migration: on first run after the upgrade, the existing in-memory
  cache is empty (server restart) — there is no migration. Old derived
  tensors disappear cleanly; new ones land on disk.

### 4.3 Invalidation rules

A cache entry is **stale** if any of:

1. Source fingerprint changed (mtime or size of the input `.nc`). This
   is a snakemake-style mtime check.
2. Provenance hash of any ancestor differs from the stored value.
   Catches the case where the user re-ran with different params and
   re-used the same `tensor_id` — the cache_key changes by construction,
   so this is mostly defensive.
3. cogpy or tensorscope version recorded in `meta.json` differs from
   current. Important: a `cogpy.spectral.psd.psd_multitaper` update can
   change numeric output. We don't auto-invalidate on version mismatch
   (would re-compute the world after every dep bump); we *flag* it as
   stale with reason="version-drift" and let the user decide.

Stale entries are not deleted automatically. They remain on disk until
the user explicitly recomputes (which writes the new entry) or runs
`tensorscope cache clean --stale`. This matches snakemake's
"out-of-date but not deleted" semantics and survives accidental mtime
churn (e.g. `git checkout` touching the `.nc`).

### 4.4 Concurrency / atomicity

Writes use `<cache_key>.tmp/` then atomic rename. `index.json` updates
via the same write-rename pattern. No file locking — TensorScope is
single-tenant per process, and the cache is the source of truth only
for *what was computed*; concurrent processes computing the same
cache_key just race to write the same content (idempotent).

## 5. Stale-cache visibility

Three surfaces, in order of effort:

1. **DAG endpoint** — extend the existing `GET /api/v1/dag` payload so
   each `DAGTensorNode` carries a `cache_status: "fresh" | "stale" |
   "missing"` and an optional `stale_reason`. The DAG view in the UI
   (`frontend/src/components/layout/DAGGraphView.tsx`) renders a colour
   badge: green/yellow/grey. **Cheapest and most useful.**
2. **`GET /api/v1/cache/status`** — returns a flat list:
   `[{cache_key, tensor_id, transform, status, reason, size_bytes,
   created_at, last_used_at}]`. Powers a "Cache" tab in the sidebar
   (post-M9, optional).
3. **CLI** — `tensorscope cache status [--stale-only]` for headless /
   batch users. Shares the same backend as (2). Same command gets a
   `clean` subcommand later.

The existing DAG round-trip already serializes node status; adding
`cache_status` is a one-field diff to `DAGTensorNode.to_dict`.

## 6. Stable IDs — precedence rules

Today: `tensor_id = request.tensor_id or f"{transform_name}_{uuid4[:8]}"`
(`executor.py:133`, `routers/transforms.py:89`).

New precedence, highest wins:

1. **Explicit yaml key** — `transforms.<key>:` in `pipeline.yaml`. Keys
   are validated as identifiers (`[a-zA-Z_][a-zA-Z0-9_]*`), unique per
   pipeline.
2. **Explicit API field** — `TransformRequestDTO.tensor_id`. Already
   wired; the UI just doesn't surface it.
3. **Auto** — `{transform}_{cache_key[:8]}` (changed from `uuid4[:8]`).
   Deterministic from inputs + params, so the same exploratory action
   produces the same id, which means cache hits across server restarts
   even without yaml.

The auto-id change is small but high-value: it gives reproducibility for
free and makes the cache hit on session restart even when the user
hasn't authored a yaml. It does mean two distinct exploratory branches
with identical params collide on id — handle by appending `_a`, `_b`
suffixes on collision in the registry, with the second writer logging a
warning.

## 7. Wildcards / fan-out — pick one

**Recommendation: option A — keep the server single-session; add a CLI
batch runner.**

```
tensorscope batch run pipeline.yaml \
    --sessions data/sub-{01,02,03}_ses-*_lfp.nc \
    --out runs/sleep-swr/
```

The CLI:

1. Glob-expands `--sessions`.
2. For each path, materialises a fresh `WorkspaceDAG` from the yaml,
   substituting `inputs.lfp.path`.
3. Runs the executor synchronously to completion. (No need for the
   FastAPI app — `TransformExecutor` is pure.)
4. Persists into a *shared* `.tensorscope-cache/` keyed by the same
   provenance hash. Multiple sessions producing the same cache_key
   (rare but possible if data is identical) collapse into one entry.

Why option A over server-side `dispatch_over=`:

- TensorScope's per-session model (one dataset per `ServerState`) was a
  deliberate scope choice. Batch dispatch in the server requires a
  multi-tenant view of the cache, the DAG, and selection — none of
  which exist. Bolting it on inflates the server's surface area for a
  workflow most users will run once a week, not interactively.
- The CLI uses the same `WorkspaceDAG` and `TransformExecutor`, so
  there's no duplicate code path. It's a thin entry point.
- Batch runs naturally want progress bars, logging, retry, partial-
  failure handling — all of which are awkward over HTTP and trivial in
  a CLI.
- Day 2 we can add a `tensorscope serve --pipeline pipeline.yaml
  --session data/foo.nc` shortcut that runs option A's loader on
  startup and drops into the viewer.

The cost is that "fan out across 30 sessions and view the results" is a
two-step workflow: batch first, then open one of the cached sessions.
That matches how snakemake users actually work (you don't open
snakemake's HTML report mid-run).

## 8. Provenance → captions

`provenance.json` already holds the structured data. A small renderer
in `core/transforms/provenance.py` walks the chain and produces:

> Multitaper PSD (NW=3, K=5, 1–80 Hz) computed over 4.0 s windows of
> `lfp_cmr`, derived from `lfp` after notch filter at 50 Hz (Q=30, 3
> harmonics) and 1–250 Hz Butterworth bandpass (order 4), with common
> median reference over (AP, ML). Software: tensorscope 0.5.1, cogpy
> 0.2.0.

Surfaces:

- `GET /api/v1/tensors/{id}/caption` returns the rendered string.
- CLI: `tensorscope provenance --tensor-id swr_avg`.
- Future hook for the figure-export path: every saved figure embeds
  the caption in PDF metadata or alongside as `.caption.txt`.

Format choices:

- One sentence per transform step, in execution order, joined with
  ", and then ".
- Numeric params rendered with units when known (Hz, s, samples).
  Unknown-unit params print as `name=value`.
- Software-version sentence at the end is mandatory — paper reviewers
  ask, and `meta.json` already has it.
- Default tone is methods-section; a `--style brief` flag drops the
  versions and the qualifying clauses.

This is incremental on top of the cache work; can ship in M10.

## 9. Out-of-scope (called out explicitly)

- **Distributed execution / clusters / SLURM.** Single machine. If you
  need a cluster, snakemake exists; export to a Snakefile (§3.4) and
  run it there.
- **Non-tensor outputs.** Figures, reports, derived event tables: the
  cache stores `xr.DataArray`s only. `EventStream`s already serialize
  through their own pickle path; bringing them into the cache is a
  separate design.
- **Cross-session derived tensors.** A "compute average across 30
  sessions" derived tensor has no home in this design — the cache is
  per-session and the yaml's `inputs:` is single-valued. Cross-session
  reductions are the point of the batch CLI, and their output is a new
  source tensor for a new pipeline, not a derived tensor in the
  original DAG.
- **Pipeline composition / sub-pipelines.** No `include:` or `import:`.
  Inline everything; copy-paste is fine for the scale of pipelines
  TensorScope users will write (≤30 transforms).
- **Conditional rules.** No `when:`, no params expressed as expressions
  over other params. If you need conditional logic, write a different
  yaml.
- **Live re-execution on raw-file change.** The server detects
  staleness and surfaces it; recompute is user-triggered. A filesystem
  watcher is over-engineering for an interactive viewer.

## 10. Effort estimate

Sequencing, single contributor, in M9 (~3 weeks):

| Step | Effort | Risk |
|------|--------|------|
| Persistent cache write-through (`.tensorscope-cache/`, zarr round-trip, mtime fingerprints) | 4 d | medium — zarr coord round-trip for non-numeric coords needs care |
| `cache_status` on DAG nodes + `/cache/status` endpoint | 1 d | low |
| DAG-view stale badges in the UI | 1 d | low |
| `pipeline.yaml` schema + load/export round-trip | 3 d | medium — needs yaml validation that mirrors `validate_params` per transform |
| CLI batch runner (`tensorscope batch run`) | 2 d | low |
| Stable-id precedence + auto-id from cache_key | 1 d | low |
| Provenance caption renderer | 2 d | low |
| Tests + docs | 2 d | — |

Total ≈ 16 working days. The cache work is the load-bearing piece; the
yaml is mostly serialization. Risk is concentrated in zarr round-trips
of weird coord dtypes (datetime64, object arrays of strings) — worth
front-loading a spike.

## 11. Open questions

1. **Cache root location.** Project root (`./.tensorscope-cache/`) or
   per-dataset (next to the `.nc`)? Project root is what snakemake
   does; per-dataset means moving the dataset moves the cache. **My
   weak preference: project root, configurable via `--cache-dir`.**
2. **Source fingerprints: hash or mtime?** mtime+size is fast but
   wrong-on-`git-checkout`. Content hash on first read, then cache the
   hash, is what `dvc` does. Mid-design choice; I'd start with
   mtime+size and add lazy content hash behind a flag.
3. **What's the policy when `pipeline.yaml` references a transform that
   no longer exists in the registry?** Hard error on load, or skip with
   a warning and let the rest of the DAG materialize? Snakemake errors
   hard; tensorscope might want softer for exploratory use.
4. **`processing` (notch/bandpass/CMR/zscore) — convert on the fly to
   DAG nodes, or keep parallel?** Keeping parallel means yaml can't
   represent "the user set processing=…", which breaks reproducibility
   for anyone using the processing UI. Convert is cleaner but rewires
   `apply_slice_request`'s `_get_processed_tensor` path. **Lean: convert,
   and treat `ProcessingParamsDTO` purely as a UI shortcut that emits
   four `transforms:` entries.**
5. **Should `outputs:` gate the on-disk cache?** Today everything is
   cached. If we cache only `outputs:`, exploratory tensors get
   re-computed every session — bad UX. If we cache everything, the
   `.tensorscope-cache/` directory grows unboundedly. **Lean: cache
   everything; offer `tensorscope cache clean --exploratory` to drop
   non-output entries.**
6. **CLI batch: what does the cross-session output look like?** Nothing
   in the yaml today says "merge derived tensors across sessions into
   one figure." Out of scope for this design, but the batch CLI's
   output layout (`runs/<pipeline>/<session>/...` vs flat) shapes the
   answer when we do tackle it.
