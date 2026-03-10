"""Concrete data modality implementations."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import xarray as xr

from tensorscope.core.data.modality import DataModality


def _sampling_rate_from_time_coord(time_vals: np.ndarray) -> float:
    tv = np.asarray(time_vals, dtype=float)
    if tv.size < 2:
        return 1.0
    dt = float(np.median(np.diff(tv)))
    if not np.isfinite(dt) or dt <= 0:
        return 1.0
    return 1.0 / dt


class GridLFPModality(DataModality):
    """Grid LFP modality backed by canonical (time, AP, ML) data."""

    def __init__(self, data: xr.DataArray):
        if data.dims != ("time", "AP", "ML"):
            raise ValueError(f"Expected dims (time, AP, ML), got {data.dims}")
        self.data = data
        self._sampling_rate = _sampling_rate_from_time_coord(self.data.time.values)

    def time_bounds(self) -> tuple[float, float]:
        return (float(self.data.time.values[0]), float(self.data.time.values[-1]))

    def get_window(self, t0: float, t1: float) -> xr.DataArray:
        return self.data.sel(time=slice(float(t0), float(t1)))

    @property
    def sampling_rate(self) -> float:
        return float(self._sampling_rate)

    @property
    def modality_type(self) -> str:
        return "grid_lfp"

    def to_flat(self) -> "FlatLFPModality":
        from tensorscope.core.schema import flatten_grid_to_channels

        return FlatLFPModality(flatten_grid_to_channels(self.data))

    def to_dict(self) -> dict:
        base = super().to_dict()
        base.update(
            {
                "shape": dict(self.data.sizes),
                "grid_size": (int(self.data.sizes["AP"]), int(self.data.sizes["ML"])),
            }
        )
        return base


class FlatLFPModality(DataModality):
    """Flat LFP modality backed by (time, channel) data."""

    def __init__(self, data: xr.DataArray):
        if data.dims != ("time", "channel"):
            raise ValueError(f"Expected dims (time, channel), got {data.dims}")
        self.data = data
        self._sampling_rate = _sampling_rate_from_time_coord(self.data.time.values)

    def time_bounds(self) -> tuple[float, float]:
        return (float(self.data.time.values[0]), float(self.data.time.values[-1]))

    def get_window(self, t0: float, t1: float) -> xr.DataArray:
        return self.data.sel(time=slice(float(t0), float(t1)))

    @property
    def sampling_rate(self) -> float:
        return float(self._sampling_rate)

    @property
    def modality_type(self) -> str:
        return "flat_lfp"

    def to_dict(self) -> dict:
        base = super().to_dict()
        base.update({"shape": dict(self.data.sizes), "n_channels": int(self.data.sizes["channel"])})
        return base


class SpectrogramModality(DataModality):
    """Spectrogram modality for time-frequency tensors."""

    _VALID_DIMS: tuple[tuple[str, ...], ...] = (
        ("time", "freq", "AP", "ML"),
        ("time", "freq", "channel"),
    )

    def __init__(self, data: xr.DataArray):
        if data.dims not in self._VALID_DIMS:
            raise ValueError(f"Expected dims {list(self._VALID_DIMS)}, got {data.dims}")
        self.data = data
        self._sampling_rate = _sampling_rate_from_time_coord(self.data.time.values)

    def time_bounds(self) -> tuple[float, float]:
        return (float(self.data.time.values[0]), float(self.data.time.values[-1]))

    def get_window(self, t0: float, t1: float) -> xr.DataArray:
        return self.data.sel(time=slice(float(t0), float(t1)))

    @property
    def sampling_rate(self) -> float:
        return float(self._sampling_rate)

    @property
    def modality_type(self) -> str:
        return "spectrogram"

    def freq_bounds(self) -> tuple[float, float]:
        return (float(self.data.freq.values[0]), float(self.data.freq.values[-1]))

    def to_dict(self) -> dict:
        base = super().to_dict()
        base.update({"shape": dict(self.data.sizes), "freq_bounds": self.freq_bounds()})
        return base


@dataclass(frozen=True, slots=True)
class SpikeUnit:
    """Single-unit spike timestamps in seconds."""

    unit_id: str
    times_s: np.ndarray


class SpikeTrainsModality(DataModality):
    """Irregular spike timestamps grouped by unit."""

    def __init__(self, units: list[SpikeUnit] | dict[str, np.ndarray]):
        if isinstance(units, dict):
            self.units = [SpikeUnit(str(k), np.asarray(v, dtype=float)) for k, v in units.items()]
        else:
            self.units = [SpikeUnit(str(u.unit_id), np.asarray(u.times_s, dtype=float)) for u in units]

    def time_bounds(self) -> tuple[float, float]:
        non_empty = [u for u in self.units if u.times_s.size]
        if not non_empty:
            return (0.0, 0.0)
        t_min = min(float(u.times_s[0]) for u in non_empty)
        t_max = max(float(u.times_s[-1]) for u in non_empty)
        return (t_min, t_max)

    def get_window(self, t0: float, t1: float) -> dict[str, np.ndarray]:
        lo = float(t0)
        hi = float(t1)
        out: dict[str, np.ndarray] = {}
        for unit in self.units:
            ts = unit.times_s
            if ts.size == 0:
                out[unit.unit_id] = ts
                continue
            i0 = int(np.searchsorted(ts, lo, side="left"))
            i1 = int(np.searchsorted(ts, hi, side="right"))
            out[unit.unit_id] = ts[i0:i1]
        return out

    @property
    def sampling_rate(self) -> float | None:
        return None

    @property
    def modality_type(self) -> str:
        return "spikes"

    def to_dict(self) -> dict:
        base = super().to_dict()
        base.update({"n_units": int(len(self.units))})
        return base
