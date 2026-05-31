"""Load a multi-detector event manifest into per-detector EventStreams.

The pixecog ``manifest_assemble`` flow writes one tidy parquet per session that
bundles every detector into a single table keyed by a ``detection_name`` column
(e.g. ``ripple_npx_hpc``, ``spindle_ieeg_cortex``, ``slowwave_so_ieeg_cortex_up``),
already enriched with ``brainstate`` and quality columns (``band_isolation_ratio``,
``common_mode_score``, ``prominence``, ``power``, ``area``, ``freq_centroid`` …).

Verified schema (sub-01/ses-04 ieeg manifest, 1.9 M rows, 24 cols, 31 detectors):
``subject, session, task, detection_name, channel_label, AP, ML, region, device,
t_start, t_peak, t_end, amplitude, peak_z, freq_peak, brainstate, segment_raw_rms,
band_isolation_ratio, prominence, power, area, freq_centroid, common_mode_score,
common_mode_artifact``. Note: the modality is encoded in ``detection_name``
(``…_npx_…`` vs ``…_ieeg_…``), NOT in ``device`` (which is ``ieeg`` or NaN here),
so probe routing keys off the detection-name segments.

TensorScope's per-file loader (`cli._load_events`) treats one parquet as one
stream and looks for a ``t``/``time`` column, so loading the manifest naively
would collapse all rows into a single mixed stream. This helper splits by
``detection_name`` into one ``EventStream`` per detector — the shape the G5
detector-overlay, G6 tags, and brainstate state-locking workflows expect.

Pure-ish: depends only on pandas + ``core.events`` (no server deps). See
``docs/design/neuropixels-multiprobe.md`` §9.1.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from tensorscope.core.events import EventRegistry, EventStream
from tensorscope.core.events.model import EventStyle

__all__ = ["load_events_manifest", "split_manifest_dataframe"]

# Time columns to try, in order. The pixecog manifest uses peak time.
_TIME_COL_CANDIDATES = ("t_peak", "t", "time", "onset", "t_start")

# Stable colors per detector family so overlaid streams stay distinguishable.
# Matched against the underscore segments of detection_name, in this order —
# `so` (slow oscillation) is checked before the generic `slowwave` so a
# `slowwave_so_*` detector gets the SO color, not the plain slow-wave color.
_FAMILY_COLORS = {
    "ripple": "#4e9bff",
    "spindle": "#b388ff",
    "so": "#ffa94d",
    "slowwave": "#ff6b6b",
    "delta": "#69db7c",
}


def _pick_time_col(df: pd.DataFrame, time_col: str | None) -> str:
    if time_col is not None:
        if time_col not in df.columns:
            raise ValueError(f"time_col {time_col!r} not in manifest columns")
        return time_col
    for cand in _TIME_COL_CANDIDATES:
        if cand in df.columns:
            return cand
    raise ValueError(
        f"no time column found; tried {_TIME_COL_CANDIDATES}, "
        f"have {list(df.columns)[:10]}…"
    )


def _segments(detection_name: str) -> set[str]:
    return set(detection_name.split("_"))


def _color_for(detection_name: str) -> str | None:
    segs = _segments(detection_name)
    for family, color in _FAMILY_COLORS.items():
        if family in segs or detection_name.startswith(family):
            return color
    return None


def split_manifest_dataframe(
    df: pd.DataFrame,
    *,
    key_col: str = "detection_name",
    time_col: str | None = None,
    probe: str | None = None,
    include: list[str] | None = None,
    min_events: int = 1,
) -> EventRegistry:
    """Split a detection-keyed manifest DataFrame into per-detector streams.

    Parameters
    ----------
    df
        The assembled manifest (one row per detected event).
    key_col
        Column whose distinct values name the streams. Default ``detection_name``.
    time_col
        Event time column. Auto-detected from :data:`_TIME_COL_CANDIDATES`
        (``t_peak`` first) when ``None``.
    probe
        If set, keep only detectors whose ``detection_name`` contains this token
        as an underscore-delimited segment (e.g. ``"ieeg"`` keeps
        ``spindle_ieeg_cortex`` and ``slowwave_so_ieeg_cortex_up``; ``"npx"``
        keeps ``ripple_npx_hpc``). This is the reliable modality signal — the
        manifest's ``device`` column is ``ieeg``/NaN and does not mark NP events.
    include
        If set, keep only these ``key_col`` values (exact match).
    min_events
        Drop streams with fewer than this many rows after filtering.

    Returns
    -------
    EventRegistry
        One :class:`EventStream` per surviving ``key_col`` value, each carrying
        all manifest columns (brainstate + quality enrichment preserved).
    """
    if key_col not in df.columns:
        raise ValueError(f"manifest missing key column {key_col!r}")
    resolved_time = _pick_time_col(df, time_col)

    registry = EventRegistry()
    for name, group in df.groupby(key_col, sort=True):
        detection = str(name)
        if probe is not None and probe not in _segments(detection):
            continue
        if include is not None and detection not in include:
            continue
        if len(group) < min_events:
            continue
        sub = group.reset_index(drop=True).copy()
        if "event_id" not in sub.columns:
            sub["event_id"] = range(len(sub))
        color = _color_for(detection)
        style = EventStyle(color=color) if color is not None else EventStyle()
        registry.register(
            EventStream(
                detection,
                sub,
                time_col=resolved_time,
                style=style,
            )
        )
    return registry


def load_events_manifest(
    path: str | Path,
    *,
    key_col: str = "detection_name",
    time_col: str | None = None,
    probe: str | None = None,
    include: list[str] | None = None,
    min_events: int = 1,
) -> EventRegistry:
    """Read a manifest parquet and split it into per-detector EventStreams.

    Thin wrapper over :func:`split_manifest_dataframe` that reads the parquet
    first. The manifest is wide but a single session fits comfortably in memory,
    so it is read whole and split rather than column-projected.
    """
    df = pd.read_parquet(path)
    return split_manifest_dataframe(
        df,
        key_col=key_col,
        time_col=time_col,
        probe=probe,
        include=include,
        min_events=min_events,
    )
