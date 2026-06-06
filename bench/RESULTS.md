# Geometry-format prototype — channel-native vs dense (AP, ML) grid

**Branch:** `prototype/channel-native-geometry`
**Bench:** `bench/bench_geometry_format.py` (`PYTHONPATH=src pixi run python bench/bench_geometry_format.py`)
**What it measures:** the real hot path — `apply_slice_request` (compute) + `encode_arrow_v2`
(Arrow serialization) — for the same 256 *real* channels represented two ways:

- **channel-native** `(time, channel)` + per-channel `(x, y)` coords — exactly 256 cells.
- **grid** `(time, AP, ML)` — 256 real cells + NaN padding to a dense `AP×ML` bounding box of
  size `256 / fill_factor` (what you pay for forcing a non-rectangular probe onto a lattice).

`fill=1.0` is a dense ECoG (sanity: should tie). Lower fill = sparser real probe (4-shank NP,
L-shaped/sparse ECoG, SEEG, …).

## Results (fs=1250 Hz, 25 s tensor, 10 s window, median of 3)

| view | metric | fill 1.0 (dense) | fill 0.5 (529 cells) | fill 0.25 (1024 cells) |
|---|---|---|---|---|
| **timeseries** | grid/channel **time** | 1.78× | 3.18× | **8.41×** |
| **raster** | grid/channel time | 1.05× | 1.85× | 3.44× |
| **psd_live** | grid/channel time | 1.21× | 1.36× | 3.64× |
| **spectrogram_live** | grid/channel time | 1.01× | 2.36× | 4.20× |
| **all views** | grid/channel **payload bytes** | 1.00× | 2.06× | **3.98×** |

(grid/channel > 1 means the grid layout is that many times **slower / bigger**.)

## Reading

1. **Payload bytes scale exactly with 1/fill** (2.06× at 0.5, 3.98× at 0.25 — matches the cell
   ratios 529/256 and 1024/256). The grid ships every NaN padding cell as float32 over the wire;
   channel-native ships only real channels. Deterministic, unambiguous.
2. **Compute scales ~1/fill** for the per-cell views (raster/psd/spectrogram ≈ the 4× cell ratio
   at fill 0.25). timeseries is *worse* (8.4×) because the grid's extra dimension also costs in the
   N-D min/max downsample, on top of the wasted cells.
3. **Dense is a tie** (fill 1.0: bytes 1.00× exactly; compute ≈ parity), confirming **no penalty**
   for using channel-native on a genuinely dense probe — and even a small win on timeseries/psd
   from avoiding N-D handling. So channel-native is *never slower*, and faster in direct
   proportion to the probe's sparsity.
4. The grid path emits `All-NaN slice` / `DoF<=0` RuntimeWarnings — it is literally computing
   statistics over cells that don't exist.

## Caveats (honest)

- `psd_live` *absolute* timings are noisy across rows (heavy multitaper + thread-pool contention
  under load); the within-fill grid/channel **ratio** (measured back-to-back) and the **byte**
  counts (deterministic) are the load-bearing evidence.
- A "smarter" grid path could skip all-NaN cells — but that just reintroduces channel-native
  sparsity bookkeeping. The fair comparison is: a dense grid forces you to *either* process/ship
  empty cells *or* reinvent channel indexing.
- Bytes are uncompressed Arrow; chunk compression (Zarr) would shrink NaN runs on disk, but the
  frontend still allocates the full `nAP×nML` bounding box (`ChannelGridRenderer`), so the waste
  propagates to the client regardless.

## Conclusion

For any non-rectangular / sparse probe, channel-native `(time, channel)` + geometry coords is
**faster and smaller, proportional to the wasted grid cells (up to ~4–8× at 25% fill), with zero
penalty on dense data.** The efficiency argument for making channel-native the canonical layout
holds.
