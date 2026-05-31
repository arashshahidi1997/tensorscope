"""Splitting a detection_name-keyed event manifest into per-detector streams.

Mirrors the pixecog ``manifest_assemble`` schema (one tidy parquet, many
detectors keyed by ``detection_name``, modality in the name segments, enriched
with brainstate + quality columns). See docs/design/neuropixels-multiprobe.md §9.1.
"""

from __future__ import annotations

import pandas as pd
import pytest

from tensorscope.io.events import load_events_manifest, split_manifest_dataframe


def _manifest() -> pd.DataFrame:
    """Mini manifest mirroring the real column set + naming convention."""
    rows = []
    for i in range(5):
        rows.append({"detection_name": "ripple_npx_hpc", "t_peak": 1.0 + i, "device": "ecephys",
                     "brainstate": "NREM", "band_isolation_ratio": 0.9, "AP": i, "ML": 0})
    for i in range(3):
        rows.append({"detection_name": "spindle_ieeg_cortex", "t_peak": 2.0 + i, "device": "ieeg",
                     "brainstate": "NREM", "band_isolation_ratio": 0.7, "AP": i, "ML": 0})
    rows.append({"detection_name": "slowwave_so_ieeg_cortex_up", "t_peak": 9.0, "device": "ieeg",
                 "brainstate": "wake", "band_isolation_ratio": 0.5, "AP": 0, "ML": 0})
    return pd.DataFrame(rows)


def test_split_by_detection_name_yields_one_stream_per_detector() -> None:
    reg = split_manifest_dataframe(_manifest())
    assert sorted(reg.list()) == [
        "ripple_npx_hpc",
        "slowwave_so_ieeg_cortex_up",
        "spindle_ieeg_cortex",
    ]
    assert len(reg.get("ripple_npx_hpc")) == 5
    assert len(reg.get("spindle_ieeg_cortex")) == 3


def test_streams_use_t_peak_and_preserve_enrichment_columns() -> None:
    reg = split_manifest_dataframe(_manifest())
    s = reg.get("ripple_npx_hpc")
    assert s.time_col == "t_peak"
    assert "brainstate" in s.df.columns
    assert "band_isolation_ratio" in s.df.columns
    assert "event_id" in s.df.columns  # auto-added
    assert tuple(s.to_dict()["time_range"]) == (1.0, 5.0)


def test_probe_filter_keys_off_detection_name_segments() -> None:
    # The manifest has no `probe` column; modality lives in the name segment.
    reg = split_manifest_dataframe(_manifest(), probe="ieeg")
    assert sorted(reg.list()) == ["slowwave_so_ieeg_cortex_up", "spindle_ieeg_cortex"]
    assert reg.get("ripple_npx_hpc") is None  # npx filtered out

    npx = split_manifest_dataframe(_manifest(), probe="npx")
    assert npx.list() == ["ripple_npx_hpc"]


def test_min_events_drops_sparse_detectors() -> None:
    reg = split_manifest_dataframe(_manifest(), min_events=2)
    assert "slowwave_so_ieeg_cortex_up" not in reg.list()  # only 1 event
    assert "ripple_npx_hpc" in reg.list()


def test_include_allowlist() -> None:
    reg = split_manifest_dataframe(_manifest(), include=["spindle_ieeg_cortex"])
    assert reg.list() == ["spindle_ieeg_cortex"]


def test_family_colors_assigned() -> None:
    reg = split_manifest_dataframe(_manifest())
    assert reg.get("ripple_npx_hpc").style.color == "#4e9bff"
    assert reg.get("spindle_ieeg_cortex").style.color == "#b388ff"
    # "so" segment present → slow-oscillation color.
    assert reg.get("slowwave_so_ieeg_cortex_up").style.color == "#ffa94d"


def test_missing_key_column_raises() -> None:
    df = pd.DataFrame({"t_peak": [1.0], "device": ["ecephys"]})
    with pytest.raises(ValueError, match="detection_name"):
        split_manifest_dataframe(df)


def test_no_time_column_raises() -> None:
    df = pd.DataFrame({"detection_name": ["ripple_npx_hpc"], "AP": [0]})
    with pytest.raises(ValueError, match="time column"):
        split_manifest_dataframe(df)


def test_explicit_time_col_override() -> None:
    df = _manifest().rename(columns={"t_peak": "onset_s"})
    reg = split_manifest_dataframe(df, time_col="onset_s")
    assert reg.get("ripple_npx_hpc").time_col == "onset_s"


def test_load_events_manifest_roundtrip(tmp_path) -> None:
    p = tmp_path / "sub-01_ses-04_task-free_events.parquet"
    _manifest().to_parquet(p)
    reg = load_events_manifest(p, probe="ieeg", min_events=2)
    assert reg.list() == ["spindle_ieeg_cortex"]
    assert reg.get("spindle_ieeg_cortex").time_col == "t_peak"
