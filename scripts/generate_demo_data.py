#!/usr/bin/env python
"""Generate a small deterministic TensorScope demo dataset."""

from __future__ import annotations

import argparse
from pathlib import Path

from cogpy.datasets.tensor import AROscillatorGrid


def build_demo_data():
    grid = AROscillatorGrid.make(
        duration=6.0,
        fs=200.0,
        nap=8,
        nml=8,
        n_bursts=6,
        f_min=6.0,
        f_max=24.0,
        burst_amp=1.5,
        background_noise=0.025,
        seed=0,
    )
    raw = grid.raw.rename({"ap": "AP", "ml": "ML"}).transpose("time", "AP", "ML")
    raw.name = "signal"
    raw.attrs["units"] = "a.u."
    raw.attrs["source"] = "cogpy.datasets.tensor.AROscillatorGrid.make"
    raw.attrs["description"] = "Deterministic demo LFP grid for TensorScope UI development"
    return raw


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a deterministic demo TensorScope dataset")
    parser.add_argument(
        "--output",
        default="data/demo_lfp.nc",
        help="Output NetCDF path",
    )
    args = parser.parse_args()

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    build_demo_data().to_netcdf(output)
    print(output)


if __name__ == "__main__":
    main()
