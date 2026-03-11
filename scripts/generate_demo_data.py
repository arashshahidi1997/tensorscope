#!/usr/bin/env python
"""Generate a complete deterministic TensorScope demo bundle.

Outputs (under ``--output-dir``, default ``data/demo/``):
  signal.nc        — raw LFP grid, dims (time, AP, ML)
  spectrogram.nc   — multitaper spectrogram, dims (time, freq, AP, ML)
  events.parquet   — ground-truth burst events table
  brainstates.nc   — dominant spectral-band label per spectrogram time step
  manifest.json    — provenance metadata for all files
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from cogpy.datasets.tensor import make_tensorscope_demo_bundle


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate a deterministic TensorScope demo bundle"
    )
    parser.add_argument(
        "--output-dir",
        default="data/demo",
        help="Output directory (default: data/demo)",
    )
    parser.add_argument("--seed", type=int, default=0, help="RNG seed (default: 0)")
    args = parser.parse_args()

    out = Path(args.output_dir)
    out.mkdir(parents=True, exist_ok=True)

    bundle = make_tensorscope_demo_bundle(
        duration=6.0,
        fs=200.0,
        nap=8,
        nml=8,
        n_bursts=6,
        f_min=6.0,
        f_max=24.0,
        burst_amp=1.5,
        background_noise=0.025,
        seed=args.seed,
    )

    # signal.nc
    signal_path = out / "signal.nc"
    bundle["signal"].to_netcdf(signal_path)
    print(f"  {signal_path}  {bundle['signal'].dims}  {bundle['signal'].shape}")

    # spectrogram.nc
    spec_path = out / "spectrogram.nc"
    bundle["spectrogram"].to_netcdf(spec_path)
    print(f"  {spec_path}  {bundle['spectrogram'].dims}  {bundle['spectrogram'].shape}")

    # events.parquet
    events_path = out / "events.parquet"
    bundle["events"].to_parquet(events_path, index=False)
    print(f"  {events_path}  {list(bundle['events'].columns)}  n={len(bundle['events'])}")

    # brainstates.nc  (int8 codes; attrs contain state_names list)
    bs_path = out / "brainstates.nc"
    bundle["brainstates"].to_netcdf(bs_path)
    print(f"  {bs_path}  {bundle['brainstates'].dims}  {bundle['brainstates'].shape}")

    # manifest.json
    manifest_path = out / "manifest.json"
    manifest_path.write_text(json.dumps(bundle["meta"], indent=2))
    print(f"  {manifest_path}")


if __name__ == "__main__":
    main()
