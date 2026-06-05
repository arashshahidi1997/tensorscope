# Multichannel timeseries display-perf prior art

**Title:** State-of-the-art and best practices for the multichannel timeseries *display performance path*
**Status:** survey complete; recommendation-grade
**Author:** background research agent
**Date:** 2026-06-05
**Scope:** The five identified weaknesses in TensorScope's time-axis / multichannel display path — server-side decimation algorithms (A), hundreds-to-thousands of channels (B), Python concurrency/GIL for the slice server (C), wire-format efficiency (D), and per-channel display normalization correctness (E). Each gets a state-of-the-art review, an honest verdict, and a recommendation mapped to a concrete file/function.

> **Companion to [`build-vs-buy-survey.md`](build-vs-buy-survey.md)** — that survey covers *whole-tool replacement* and *which chart library*. **This one covers the *display perf path* — how to make our existing tool fast and correct at 384+ channels — not whether to replace it.** Where the two overlap (uPlot's ceiling, Datashader, fastplotlib) this document goes deeper on the perf mechanics and deliberately does not re-litigate the "should we replace TensorScope" question. Read that one first for the strategic framing.

---

## TL;DR — top 5 actionable recommendations (ranked impact-vs-cost)

| # | Recommendation | File / function | Impact | Cost |
|---|---|---|---|---|
| **1** | **Channel-window the *fetch*, not just the draw.** The frontend draws `N_VISIBLE = 16` but the server ships **all** channels (`raw.series.slice(start, …)` discards ~94%). Add a `channel_range` to the slice request and `.isel(channel=…)`/AP-ML-subset server-side. This is the single biggest win for 384-ch Neuropixels — every mature viewer (phy, MNE-qt-browser) fetches only the visible window. | `TimeseriesSliceView.tsx:333,360`; `queries.ts:makeDefaultSliceRequest`; `state.py:apply_slice_request` | **Very high** (cuts the dominant payload + decode by ~16×) | Medium |
| **2** | **Fix per-channel normalization: compute the scale ONCE (global per-channel, or a fixed µV/division), not window-local on the decimated envelope.** Window-local z-score on the LOD envelope makes amplitude non-comparable across pan/zoom — the opposite of every clinical/EEG convention. | `state.py:zscore_offset` (~1508); `TimeseriesSliceView.tsx` auto-gain IQR (~436) | **High** (correctness bug, not just perf) | Low–Medium |
| **3** | **Vectorize `downsample_time_axis` — kill the `for i in range(n_buckets)` loop** (it claims "fully vectorized" but isn't). Use `reshape → argmin/argmax(axis=1)` for equal buckets (or `np.minimum.reduceat`/`maximum.reduceat` for ragged), the same trick `tsdownsample` uses. | `state.py:downsample_time_axis` (~1602) | **High** (this loop is on every Tier-0 LOD build + envelope) | Low |
| **4** | **Offload the slice/PSD compute to a threadpool with request prioritization** so a cheap timeseries doesn't queue behind a multi-second multitaper PSD. NumPy/FFT release the GIL, so `run_in_threadpool` + a small bounded pool gives real parallelism today (no free-threaded build needed). | `server/routers/*`, `apply_slice_request` | **High** (kills the head-of-line block on a selection fan-out) | Medium |
| **5** | **Add a dense-channel "image/carpet" render mode** (heatmap of channel×time) as the default above ~64–128 channels, instead of N line traces. TensorScope already has `depth_map` — this is the same primitive; just make it the auto-fallback for high channel counts. uPlot/line rendering degrades past ~100–200 series. | `viewGridLayout.ts`, `depth_map` view; `registry/viewRegistry.ts` | **High** (line rendering doesn't scale to 384; images do) | Medium |

**Two things NOT to change** (current design is correct): the **min/max-with-real-extremum-timestamps** envelope (`downsample_time_axis` Audit-F5 logic — emitting each feature's true min/max at real sample times is *better* than naive bucket-edge M4 and preserves spikes); and the **LOD-tile-snapping + per-view LRU cache** (`snapWindowToLodTiles`, `_view_result_cache`) — this is exactly the plotly-resampler "aggregate-relative-to-view, cache, send only the update" architecture and it's right.

---

## A — Server-side time-axis decimation algorithms

### What TensorScope does today
`downsample_time_axis` (`state.py:1553`) builds equal-index buckets (`np.linspace(0, time_len, …)`) and, per bucket, emits **two** points: each feature's true bucket-min and bucket-max, anchored at the *real source-time* of the dominant feature's extremum (Audit-F5). It then sorts by time. The Tier-0 LOD ladder (`_LOD_LEVELS = (4_000, 16_000, 64_000)`) is built by running this same MINMAX decimation on the full processed tensor (`_get_lod_levels`, ~372). The frontend snaps fetch windows to a power-of-two-second tile grid (`snapWindowToLodTiles`) and derives `max_points` from pixel width (`timeseriesPointBudget`).

### State of the art

**M4 (Jugel, Jerzak, Hackenbroich, Markl — VLDB 2014, Best Paper).** M4 selects **four** tuples per pixel column — `min`, `max`, **`first`**, **`last`** — by grouping on the rounded pixel x-coordinate. The paper's load-bearing claim, verbatim from §2.2 (Line Charts): *"Note that — contrary to common practice of only selecting the min and max tuples per pixel column — min(v) and max(v) tuples per pixel column is **not sufficient** to produce a correct line visualization."* The `first`/`last` points are what make the line that **connects across bucket boundaries** land on the right pixels; with min/max only, the connecting segment between two buckets is drawn between a bucket's min/max and the next bucket's min/max, which can be vertically wrong at the boundary. Their query monitor (Fig. 6) quantifies it on a 5M→10k reduction: **MinMax = 172 px error, M4 = 0 px error** ("always matches perfectly with the baseline"), while plain pixel-column averaging distorts extrema badly. M4 fetches at most `4·w` tuples (w = chart width in px); the data-reduction ratio is "up to several orders of magnitude" with response time dropping from 87 s to 5.4 s in their demo. ([M4 PDF](http://www.vldb.org/pvldb/vol7/p1705-jugel.pdf), [DOI](https://dl.acm.org/doi/10.14778/2732951.2732953))

**LTTB (Steinarsson 2013).** Largest-Triangle-Three-Buckets picks **one** point per bucket — the one forming the largest triangle with the previous selected point and the next bucket's average. It is the perceptual gold standard for *shape* but, being one-point-per-bucket and triangle-area-based, it can miss a narrow spike that min/max would catch, and it's `O(n)`-with-a-constant slower than min/max. ([thesis PDF](https://skemman.is/bitstream/1946/15343/3/SS_MSthesis.pdf))

**MinMaxLTTB (Van Der Donckt et al., 2023).** Two-stage: (i) MinMax preselects a small ratio (default ~`minmax_ratio·n_out` per LTTB bucket) of extreme candidates, (ii) LTTB runs on only those. Visual output is indistinguishable from full LTTB but it is **up to 10× faster single-core / 30× multi-core than the LTTB C implementation, and downsamples 1 B points in <0.1 s**. This is the default aggregator in plotly-resampler. ([arXiv 2305.00332](https://arxiv.org/abs/2305.00332))

**tsdownsample (predict-idlab).** Rust+SIMD implementations of `MinMaxDownsampler`, `M4Downsampler`, `LTTBDownsampler`, `MinMaxLTTBDownsampler` (+ NaN variants), exposed as a NumPy-returning Python API (`MinMaxLTTBDownsampler().downsample(x, y, n_out=1000)` returns **indices**, so you gather with `y[idx]`). It is built on the `ArgMinMax` SIMD crate (also adopted by polars). The paper reports a peak throughput of **45 GB/s** (extrapolated int64) and notes adopting it gave plotly-resampler a **3–30× speedup** over its prior C backend. ([arXiv 2307.05389](https://arxiv.org/abs/2307.05389), [repo](https://github.com/predict-idlab/tsdownsample), [SoftwareX](https://www.sciencedirect.com/science/article/pii/S2352711025000123))

**How the fast libraries vectorize (the key for our loop).** tsdownsample's approach is per-bin `ArgMinMax` with a "search-sorted bin-index generator," parallelized across bins. In pure NumPy the standard fully-vectorized equivalents are:
- **Equal-size bins:** `arr.reshape(n_buckets, bucket_len, n_feat)` then `.argmin(axis=1)` / `.argmax(axis=1)` — one C-level reduction, no Python loop.
- **Ragged bins** (our `np.linspace` edges aren't exactly equal): `np.minimum.reduceat(arr, starts, axis=0)` and `np.maximum.reduceat(arr, starts, axis=0)` give the per-bucket min/max values directly. (For the *argmin position* — which we need for the real-extremum timestamp — combine `reduceat` on a `(value, local_index)` structured trick, or pad-to-equal-and-`reshape`.) tsdownsample notes that with gaps "fewer than n_out indices may be returned" — the same empty-bucket handling our code already does with the `valid = stops > starts` mask. ([NumPy reduceat](https://numpy.org/doc/stable/reference/generated/numpy.ufunc.reduce.html))

**How databases / Grafana / InfluxDB do it.** All converge on server-side, view-relative aggregation: Grafana's `max_data_points` ≈ panel pixel width, and InfluxDB/Prometheus downsample with `min`/`max`/`mean`/`first`/`last` aggregations over time buckets sized to the query range. This is structurally identical to TensorScope's `timeseriesPointBudget` + LOD ladder — we already do the right thing architecturally. plotly-resampler is the cleanest reference for the exact pattern: a zoom event sends `relayoutData` to the backend, the backend re-aggregates only the new view, and **only the updated trace data** is returned. ([plotly-resampler](https://github.com/predict-idlab/plotly-resampler))

### Verdict
1. **The Python loop in `downsample_time_axis` (line 1602) contradicts its own docstring** ("fully vectorized via numpy — no Python loop over buckets"). For 256 channels × thousands of buckets it's the dominant cost in every cold LOD build. **Vectorize it** with `reshape→argmin/argmax(axis=1)` (equal buckets) or `reduceat` (ragged). Adopting **`tsdownsample`** outright is even simpler and faster (Rust+SIMD, MIT-friendly, returns indices you gather) — but it downsamples one (x, y) series at a time, so for the (time, n_feat) case you'd loop over features *in Rust*, or keep our reshape approach for the multi-feature path. **Recommendation: vectorize in NumPy first (zero new dep, ~½ day); evaluate tsdownsample as a drop-in for the single-channel navigator path.**
2. **M4 vs MinMax: mostly don't bother, but know the tradeoff.** M4's `first`/`last` matter when you draw *connected line segments across bucket boundaries at pixel density*. TensorScope's envelope already anchors each emitted point at its **real source-time** (not the bucket edge) and sorts by time — this is strictly better than naive bucket-edge MinMax and avoids most of M4's boundary error, because the connecting segment is drawn between true sample positions. The remaining gap (M4's 0-px vs MinMax's 172-px in the paper) is largest at extreme reduction ratios on a single dense trace. **Recommendation: keep min/max-with-real-timestamps as the default; do NOT add first/last globally.** If a future "single-channel pixel-perfect" mode is wanted, add M4 there only.
3. **LTTB**: the existing `DownsampleMethod.LTTB` branch is a naive `np.linspace` *stride* (line 1565), **not actual LTTB** — it just subsamples every k-th point, which drops spikes. Either implement real LTTB/MinMaxLTTB (via tsdownsample) or remove the misleadingly-named branch. **Recommendation: rename the current branch to `STRIDE`, and if LTTB is genuinely wanted, back it with tsdownsample.**

---

## B — Hundreds-to-thousands of channels (the real gap)

### What TensorScope does today
The server ships **all** channels. The frontend (`TimeseriesSliceView.tsx`) takes the full decoded set and does `cap = raw.series.slice(start, start + N_VISIBLE)` with `N_VISIBLE = 16` (line 333/360–361) — so for a 384-channel Neuropixels probe it **decodes and discards 368 channels per request**. There is no `channel_range` in the slice request; channel windowing is purely a frontend `.slice()`.

### How mature multichannel viewers handle it

| Viewer | Stack | Channel strategy | Fetch model |
|---|---|---|---|
| **phy** (cortex-lab) | PyQtGraph/OpenGL | TraceView "shows only a subset of the total trace at any given time"; data is a **virtual memmapped** `(n_samples, n_channels)` array; raw waveforms fetched **on demand**. Docs explicitly warn: *"If the window … is increased too much … performance will decrease … keep the window small and shift it."* | **Window-bound, lazy** — reads only the visible time×channel block from the memmap. ([phy viz docs](https://phy.readthedocs.io/en/latest/visualization/)) |
| **MNE-qt-browser** | PyQtGraph (+ optional OpenGL) | Paginates with a fixed `n_channels` per page (`PageUp`/`PageDown`); precompute-into-RAM with `'auto'` heuristic; **OpenGL** render path for many items. Known to struggle with many *annotations* ([issue #161](https://github.com/mne-tools/mne-qt-browser/issues/161)). | Loads into RAM, draws only the page. ([repo](https://github.com/mne-tools/mne-qt-browser)) |
| **Open Ephys LFP Viewer** | JUCE/OpenGL | **"Skip" option = display every Nth channel** ("useful … with many densely spaced contacts"); **"Sort by depth"**; up to 3 stacked/side-by-side segments. Line traces by default. | Subsample by stride; no image mode. ([docs](https://open-ephys.github.io/gui-docs/User-Manual/Plugins/LFP-Viewer.html)) |
| **Neuroscope2 / ephyviewer / IBL viewephys** | MATLAB / PyQtGraph | Channel scroll + spatial (by-depth) ordering; viewephys is the IBL standard for raw 384-ch inspection. | Window-bound. |

**The cross-cutting lesson:** *nobody* ships all channels to draw a few. They either (a) **window the fetch** to the visible time×channel block (phy memmap, the strongest model), or (b) **subsample by stride** ("Skip" every Nth), or (c) **switch to an image**.

**Image / "carpet plot" rendering for dense channels.** The canonical move past ~tens of channels is to stop drawing N lines and draw a **heatmap of channel(or depth)×time** — a "carpet plot." It's the standard fMRI QC view (voxel×time heatmap; [Nature Sci Rep 2021](https://www.nature.com/articles/s41598-021-86402-z)) and the standard Neuropixels LFP-depth view. **TensorScope already has exactly this primitive: `depth_map` (a windowed depth×time image).** The gap is purely UX: it isn't the *automatic* representation when channel count is high.

**WebGL line rendering for many traces.** When you *do* want lines at high count, Canvas2D/uPlot hit a ceiling:
- **uPlot** lives-streams at 60 fps and renders 150k points in ~90 ms, but is documented to "struggle beyond ~100k in-view points," and users report needing to **fork it past ~200 series** (hover/cursor hit-testing across many series is the bottleneck). uPlot is right for ≲100 series, not 384. ([uPlot](https://github.com/leeoniya/uPlot), [issue #682](https://github.com/leeoniya/uPlot/issues/682))
- **webgl-plot** (danchitnis, MIT) is purpose-built for "real-time multiple waveforms" (oscilloscope/biomedical/EEG), single-draw native WebGL lines, "excellent performance even with tens of thousands of data points." Thick lines are ~6× slower than thin. It's the natural escape hatch for a many-line WebGL timeseries. ([repo](https://github.com/danchitnis/webgl-plot))
- **regl / PixiJS / two.js** are lower-level WebGL — only worth it if webgl-plot's model doesn't fit (covered as "escape hatch" in the build-vs-buy survey §2.4).

**Cheap overview lane for the scrollbar.** phy/Neuroscope effectively give a coarse whole-recording context; the cheap server-side trick is to send a **per-channel RMS/envelope summary** (one value per channel per coarse time bin) for an overview strip while only the visible window is full-res. This is the `_LOD_LEVELS` coarsest tier reused as an overview — TensorScope is one small view away from it.

**Server-renders-frames model (fastplotlib / pygfx).** For *truly* huge channel counts the alternative architecture is server-side WGPU rendering streaming JPEG frames to the client (fastplotlib's model). Covered in build-vs-buy §2.7 as "not now"; it's the right answer only if we add a Jupyter-embedded surface. **Defer.**

### Verdict
**This is the real gap, and it has two independent fixes:**
1. **Channel-window the fetch (Rec #1).** Add `channel_range: [start, count]` (or an AP/ML sub-box) to `TensorSliceRequestDTO`; have `apply_slice_request` `.isel`/`.sel` the channel block **before** decimation and serialization. The frontend's `tsFirstChannel` + `N_VISIBLE` become the request params instead of a post-hoc `.slice()`. This is the phy model and cuts the dominant cost ~16× for the timeseries view. **Note:** keep the cheap overview lane on the *full* channel set (per-channel RMS) so the scrollbar still shows all 384.
2. **Auto-switch to image mode above a channel threshold (Rec #5).** Promote `depth_map`/a channel×time heatmap to the default representation when `n_channels > ~64–128`. Line traces simply do not scale to 384 in any of the surveyed tools; every one of them either subsamples or goes to an image. For the line view that remains, **uPlot is fine ≤~64 windowed channels** — only reach for **webgl-plot** if a "show all 384 as lines" mode is explicitly required (it usually isn't; the image is better).

---

## C — Python concurrency / GIL for the slice server

### The problem
One selection change fan-outs ~6 simultaneous heavy requests (timeseries + navigator + spatial + 2×PSD + spectrogram). They run as synchronous Python on one GIL; a cheap timeseries can queue behind a multi-second multitaper PSD (head-of-line blocking).

### State of the art

**Does NumPy/Arrow release the GIL?** **Yes, for most low-level array ops** — but adversarially verified, with caveats. The NumPy thread-safety page states: *"Because NumPy releases the GIL for many low-level operations, threads that spend most of the time in low-level code will run in parallel,"* and generalized ufuncs unlock the GIL (since NumPy 1.14). **The exception:** `dtype=np.object_` arrays do **not** release the GIL. FFT-heavy code (scipy/pocketfft/ghostipy multitaper) generally releases the GIL during the C/Fortran transform, and Arrow IPC serialization releases it during buffer copies. So slicing, decimation (argmin/argmax/reduceat), and the multitaper PSD's FFTs are all **GIL-releasing** → real parallelism from threads is achievable today. ([NumPy thread safety](https://numpy.org/doc/stable/reference/thread_safety.html)) The one rule: don't share-mutate arrays across threads — our per-view caches are read-after-compute, which is the recommended "each worker owns its array" pattern.

**FastAPI offload patterns.**
- **`run_in_threadpool` / `asyncio.to_thread`** (Starlette) — simplest; gives true parallelism *because the heavy ops release the GIL*. Right tool here. ([Sentry: run_in_executor vs run_in_threadpool](https://sentry.io/answers/fastapi-difference-between-run-in-executor-and-run-in-threadpool/))
- **`ProcessPoolExecutor` / loky** — bypasses the GIL entirely but pays **array serialization (pickle) cost** to ship the slice to the worker and back. For our case the input is the *full processed tensor* (already in the parent) and the output is an Arrow buffer — shipping either across a process boundary is expensive and partly defeats the win. Only worth it for pure-Python CPU-bound work that does *not* release the GIL (we have little of that). The zero-copy mitigations (shared-memory `/dev/shm`, Arrow Plasma/`pyarrow` IPC into shared memory) exist but add real complexity.
- **dask** — overkill; it's for out-of-core/distributed, which the build-vs-buy survey already ruled out (session fits in RAM).

**Free-threaded Python (PEP 703) and subinterpreters (PEP 684/734), 2025/2026 status.** Free-threaded CPython went from *experimental* (3.13, ~40% single-thread overhead) to **officially "supported" (not experimental)** with **PEP 779 accepted** and 3.14's specializing interpreter cutting the single-thread penalty to **~5–10%**. NumPy 2.1+, SciPy, and FastAPI ship free-threaded wheels. **But:** it is still **not the default build**, full ecosystem compatibility "varies," and it *adds* thread-safety risk (object arrays unprotected). Subinterpreters (PEP 734) are a complementary isolation model but immature for this. **Verdict for 2026: do not depend on the free-threaded build in production yet** — but the good news is you *don't need to*, because the heavy ops already release the GIL under the normal build. ([Python free-threading howto](https://docs.python.org/3/howto/free-threading-python.html), [PEP 779 discussion](https://discuss.python.org/t/pep-779-criteria-for-supported-status-for-free-threaded-python/84319))

**Request prioritization / cancellation.** Prior art: plotly-resampler and most interactive servers debounce + cancel superseded requests; databases run cheap queries on a priority lane. The concrete patterns:
- **Tiered threadpools:** a small high-priority pool for Tier-0 views (timeseries/navigator — cheap, latency-critical) and a separate bounded pool (or semaphore) for Tier-2 (psd_live/spectrogram_live — expensive). A cheap view never waits behind a PSD because they don't share workers.
- **Cancellation:** when a new selection arrives, cancel in-flight requests for the *previous* selection (the frontend already keys queries by selection; server-side, an `asyncio` task tied to the request that checks a cancel token between stages). The existing `_view_result_cache` means a re-issued window is a cache hit anyway.

### Verdict
**Adopt `run_in_threadpool` + tiered priority (Rec #4).** Because slicing, decimation, and FFT all release the GIL, wrapping the slice handler in `run_in_threadpool` gives immediate parallelism on the fan-out — no process pool, no free-threaded build, no serialization cost. Add a **small bounded semaphore for the expensive PSD/spectrogram views** so they can't starve the cheap timeseries/navigator. Skip ProcessPoolExecutor (serialization cost ≈ the compute we're trying to parallelize). Skip the free-threaded build for now (not default, not worth the 5–10% single-thread tax + compat risk when threads already parallelize the GIL-releasing work).

---

## D — Wire-format efficiency for timeseries

### What TensorScope does today
Ships **float32** in Arrow IPC (long-format columnar, one row per cell), base64-wrapped in v1 and raw-bytes in v2 (`encode_arrow_payload`, ~1640). No IPC buffer compression. Native iEEG/Neuropixels is **int16 µV** (with a per-channel gain+offset).

### State of the art

**Native format is int16 (or int24).** EDF/EDF+ store **16-bit** samples; BDF/BDF+ store **24-bit** (BioSemi). The physical value is reconstructed as `physical = digital · gain + offset`, with **per-signal gain/offset** in the header. Neuropixels AP/LFP are int16. So a value goes int16-on-disk → float for compute → and TensorScope currently sends float32 (4 bytes) where the source was 2 bytes. ([EDF spec](https://www.edfplus.info/specs/edf.html), [EDF+/BDF+](https://emotiv.gitbook.io/emotivpro-v3/managing-your-eeg-data-recordings/exporting-an-eeg-data-recording/edf+-bdf+))

**Quantized / int16 transport.** Sending int16 + a per-channel `(scale, offset)` and reconstructing `float = int16·scale + offset` in the frontend **halves the wire size vs float32** with zero fidelity loss for data that was int16 to begin with. For *already-decimated min/max envelope* data the fidelity bar is even lower — the envelope is a display approximation, so int16 (or even int8 after per-channel normalization) is visually lossless at screen resolution.

**Arrow IPC body-buffer compression (ARROW-300).** Each IPC body buffer can be **independently compressed with LZ4 or ZSTD**, with a 64-bit uncompressed-size prefix; a `-1` prefix marks an uncompressed buffer (so tiny buffers skip compression). pyarrow exposes it via `IpcWriteOptions(compression="lz4"|"zstd")`, and C++ has a `min_space_savings` knob (skip compression if savings < threshold). ZSTD on float/int timeseries typically gives **2–4×** on the wire. ([Arrow IPC](https://arrow.apache.org/docs/cpp/api/ipc.html), [IpcWriteOptions](https://arrow.apache.org/docs/python/generated/pyarrow.ipc.IpcWriteOptions.html), [ARROW-300](https://github.com/apache/arrow/pull/6707))

> **Critical adoption caveat (verified against a second source):** the **JS** side must register the codec. arrow-js *recently* added `registerCompressionCodecs()`; **LZ4 is bundled (no penalty), but ZSTD triggers a separate fetch** of the codec, and older `apache-arrow` releases **did not decode compressed IPC at all**. TensorScope is on **`apache-arrow@19.0.1`**, which predates robust built-in IPC decompression — so adopting Arrow compression would require **a frontend upgrade + explicit codec registration**, or it silently fails to decode. Don't flip `compression="zstd"` on the server without verifying the browser decodes it. ([arrow-over-http](https://felipe.rs/2024/10/23/arrow-over-http/), [arrow-js #298](https://github.com/apache/arrow-js/issues/298))

**float16.** Halves size vs float32 but has only ~3 decimal digits of precision and limited fast-path support; for envelope display it's adequate but **int16+scale is strictly better** (same 2 bytes, exact for int16-origin data, native frontend support). **Skip float16.**

**delta/RLE.** Arrow's dictionary/RLE encodings help categorical/repetitive columns (our long-format `time`/`channel` index columns repeat heavily!) but not the float `value` column. Switching the v2 path away from long-format (repeating index columns) to a **dense 2-D buffer** (channel-major or time-major) already removes the repeated-index overhead that RLE would otherwise be compensating for.

**What production viewers send.** EDF streaming sends raw int16/int24. Neurosift byte-ranges the HDF5 (int16) directly. The pattern is: **send the integers + the scale, reconstruct on the client.** Nobody inflates int16 to float32 for transport.

### Verdict
Ranked:
1. **Send int16 (or int8 for the normalized envelope) + per-channel `(scale, offset)`; reconstruct in the frontend.** Halves (or quarters) the wire vs float32, lossless for int16-origin data, and matches what every native viewer does. Best ROI, no new dependency, no decode-codec risk. **For the min/max envelope specifically, int8-after-normalization is visually lossless at screen resolution.**
2. **Adopt a dense 2-D Arrow buffer for the v2 timeseries path** (drop long-format's repeated index columns) — this is a bigger structural win than compression and removes the need for RLE on index columns.
3. **Arrow IPC LZ4 compression — only after the int16 + dense changes, and only after verifying the frontend decodes it** (upgrade `apache-arrow`, register LZ4 — it's bundled, no fetch). ZSTD gives more but needs a fetched codec; LZ4 is the safe default. Compression is **least urgent** because int16+dense already cuts ~4× and avoids the CPU cost of (de)compression on every interactive request.

---

## E — Per-channel display normalization correctness

### What TensorScope does today
`zscore_offset` (`state.py:1508`) z-scores **each channel** using `mean`/`std` computed over the **time axis of the current slice** — i.e., **window-local** — and the slice it operates on is the **decimated LOD envelope**, not the raw signal. The frontend additionally has an auto-gain IQR path (`TimeseriesSliceView.tsx:~436`). **Consequence:** a channel's displayed amplitude **changes as you pan/zoom**, because the normalization constant is recomputed from whatever happens to be in view (and from the *envelope*, not the true signal). Amplitude is therefore **not comparable across channels at a fixed moment, nor across navigation.**

### Why this is considered wrong — best practice

**Clinical / EEG convention: fixed sensitivity (µV per division), identical across all channels and all time.** The ACNS guideline and standard practice set EEG sensitivity in the **5–10 µV/mm** range with **7 µV/mm as the default**; *"the higher the number the lower the sensitivity,"* and the **same** sensitivity is applied to **every channel** so deflections are directly comparable, and it does **not** change as you scroll. Sensitivity is a **fixed gain**, changed only deliberately by the reader (a known, global step). ([ACNS Guideline 1](https://www.acns.org/UserFiles/file/EEGGuideline1Tech_finalrev20160411clean_v1.pdf), [learningeeg montages](https://www.learningeeg.com/montages-and-technical-components))

**MNE-Python's scrolling browser: a single global scaling, manually stepped, NOT per-window.** `plot_raw` applies **one `scalings` factor per channel *type*** (e.g. all EEG share a scale), adjusted with the **`-`/`+`/`=` keys** — a deliberate, global gain. The `'auto'` option sets the factor to the **99.5th percentile of the *respective data*** — i.e., computed **once over the data**, not recomputed per visible window. Butterfly mode (`b`) overlays all channels on the same scale precisely *to compare amplitudes*. The whole design is "fixed scale, occasionally and globally adjusted," the opposite of per-window auto-gain. ([mne.viz.plot_raw](https://mne.tools/stable/generated/mne.viz.plot_raw.html))

**Neuroscope2 / phy / clinical reviewers** all follow the same principle: one gain knob (often per-group), applied uniformly, persistent across scroll. None recompute a per-channel scale from the visible window on every pan.

**Why window-local auto-gain is wrong, specifically:**
- **Amplitude becomes non-physical and non-comparable.** A 200 µV epileptiform spike and a 20 µV background look the *same height* if each window/channel is independently renormalized — you destroy the one feature (relative amplitude) clinicians and electrophysiologists read.
- **It computes the scale from the *decimated envelope*, not the signal** — so the normalization is keyed off a display artifact and drifts with the LOD level.
- **It is unstable under navigation** — panning a few hundred ms can re-scale a channel because its in-window std changed, which reads as the signal "breathing." This is a known anti-pattern; it's why MNE's `'auto'` is computed once, not per view.

### Verdict
**Fix the normalization (Rec #2):**
- **Compute the per-channel scale ONCE** — either over the whole recording (like MNE `'auto'` = a high percentile / robust std per channel, cached alongside the tensor) **or** offer a **fixed µV/division** mode (the clinical default; with int16+gain from D this is free — you know the µV). Apply that **constant** scale regardless of the current window or LOD level.
- **Keep auto-gain only as an explicit, one-shot user action** ("fit to view" button), never as the per-request default. When the user pans, the scale must not move.
- This also **simplifies the server**: `zscore_offset` no longer needs the windowed slice — the per-channel scale is a property of the tensor, computed at load (or first request) and cached. The vertical stacking offset stays as-is.

This is a **correctness fix, not a perf fix** — but it's cheap and it removes a genuinely confusing behavior that diverges from every reference tool.

---

## What NOT to do (current design is correct — leave it alone)

1. **Don't replace the min/max-with-real-extremum-timestamps envelope** (`downsample_time_axis` Audit-F5 logic). Emitting each *feature's* true bucket-min and bucket-max at their **real source-time positions** is *better than* textbook bucket-edge MinMax and avoids most of M4's boundary error (because connecting segments land on true sample times). Keep it. Just **vectorize** it (A) — the algorithm is right, the loop is wrong.
2. **Don't add M4's first/last globally.** The real-timestamp anchoring already addresses the boundary artifact M4's first/last exist to fix. Add M4 only behind a future single-channel pixel-perfect mode.
3. **Don't touch the LOD-tile-snapping + per-view LRU cache** (`snapWindowToLodTiles`, `_view_result_cache`, `_lod_cache`). This is exactly the plotly-resampler / Grafana "aggregate-relative-to-view + cache + send-only-updates" architecture, and the pan-invariant power-of-two tile grid is a genuinely good cache-hit design.
4. **Don't reach for ProcessPoolExecutor, dask, or the free-threaded Python build** for concurrency. The heavy ops release the GIL, so a plain threadpool parallelizes them today — the exotic options add serialization cost / instability for no extra parallelism here.
5. **Don't adopt Arrow ZSTD compression first** (or before D's int16+dense changes, or before the `apache-arrow` frontend upgrade). int16+dense-buffer is a bigger, simpler win and avoids per-request (de)compression CPU and the JS codec-registration footgun.
6. **Don't migrate the timeseries to WebGL just to draw more lines.** Above ~64–128 channels the *correct* representation is an image (carpet/`depth_map`), which TensorScope already has — reach for webgl-plot only if a literal "all 384 as lines" mode is a hard requirement.

---

## Sources

**A — decimation**
- M4 (Jugel et al., VLDB 2014): <http://www.vldb.org/pvldb/vol7/p1705-jugel.pdf> · <https://dl.acm.org/doi/10.14778/2732951.2732953>
- VDDA (M4 journal extension): <https://link.springer.com/article/10.1007/s00778-015-0396-z>
- LTTB (Steinarsson 2013 thesis): <https://skemman.is/bitstream/1946/15343/3/SS_MSthesis.pdf>
- MinMaxLTTB (Van Der Donckt et al. 2023): <https://arxiv.org/abs/2305.00332> · <https://github.com/predict-idlab/MinMaxLTTB>
- tsdownsample (paper / repo / SoftwareX): <https://arxiv.org/pdf/2307.05389> · <https://github.com/predict-idlab/tsdownsample> · <https://www.sciencedirect.com/science/article/pii/S2352711025000123>
- plotly-resampler: <https://github.com/predict-idlab/plotly-resampler>
- NumPy reduceat: <https://numpy.org/doc/stable/reference/generated/numpy.ufunc.reduce.html>

**B — many channels**
- phy visualization (memmap, visible-window): <https://phy.readthedocs.io/en/latest/visualization/> · <https://github.com/cortex-lab/phy>
- MNE-qt-browser: <https://github.com/mne-tools/mne-qt-browser> · <https://github.com/mne-tools/mne-qt-browser/issues/161>
- Open Ephys LFP Viewer (Skip/sort-by-depth): <https://open-ephys.github.io/gui-docs/User-Manual/Plugins/LFP-Viewer.html>
- Carpet plots (fMRI dense-channel image): <https://www.nature.com/articles/s41598-021-86402-z>
- uPlot (ceiling, ~200-series fork): <https://github.com/leeoniya/uPlot> · <https://github.com/leeoniya/uPlot/issues/682>
- webgl-plot (MIT, many-trace WebGL): <https://github.com/danchitnis/webgl-plot>
- IBL neuropixel / viewephys: <https://github.com/int-brain-lab/ibl-neuropixel>

**C — concurrency / GIL**
- NumPy thread safety (GIL release + free-threaded): <https://numpy.org/doc/stable/reference/thread_safety.html>
- FastAPI run_in_executor vs run_in_threadpool: <https://sentry.io/answers/fastapi-difference-between-run-in-executor-and-run-in-threadpool/>
- Python free-threading howto: <https://docs.python.org/3/howto/free-threading-python.html>
- PEP 779 (supported-status criteria): <https://discuss.python.org/t/pep-779-criteria-for-supported-status-for-free-threaded-python/84319>

**D — wire format**
- EDF spec: <https://www.edfplus.info/specs/edf.html>
- EDF+/BDF+ (16/24-bit, gain/offset): <https://emotiv.gitbook.io/emotivpro-v3/managing-your-eeg-data-recordings/exporting-an-eeg-data-recording/edf+-bdf+>
- Arrow IPC (body-buffer compression): <https://arrow.apache.org/docs/cpp/api/ipc.html>
- pyarrow IpcWriteOptions: <https://arrow.apache.org/docs/python/generated/pyarrow.ipc.IpcWriteOptions.html>
- ARROW-300 (LZ4/ZSTD proposal): <https://github.com/apache/arrow/pull/6707>
- arrow-js compression registration / caveat: <https://github.com/apache/arrow-js/issues/298> · <https://felipe.rs/2024/10/23/arrow-over-http/>

**E — normalization**
- ACNS EEG Guideline 1 (sensitivity µV/mm): <https://www.acns.org/UserFiles/file/EEGGuideline1Tech_finalrev20160411clean_v1.pdf>
- learningeeg (montages/sensitivity): <https://www.learningeeg.com/montages-and-technical-components>
- MNE plot_raw (global scalings, +/- keys, auto=99.5pct once): <https://mne.tools/stable/generated/mne.viz.plot_raw.html>

---

## Cross-refs
- Companion: [`build-vs-buy-survey.md`](build-vs-buy-survey.md) (whole-tool replacement + chart-library choice)
- Implementation: `src/tensorscope/server/state.py` (`downsample_time_axis`, `_get_lod_levels`, `zscore_offset`, `_view_result_cache`), `frontend/src/api/queries.ts` (`timeseriesPointBudget`, `snapWindowToLodTiles`), `frontend/src/components/views/TimeseriesSliceView.tsx` (`N_VISIBLE`, auto-gain)
- Perf history: `docs/design/perf-navigation-plan.md` (P1–P8, the LOD ladder + caches this builds on)
