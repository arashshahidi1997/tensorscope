"""Probe layout sidecar — minimal v0.

A trivial loader for per-electrode region annotations. The richer
`ProbeLayout` design in `docs/design/probe-layout.md` (groups, geometry,
reference scheme) is intentionally deferred — this v0 only carries what
G7 surfaces on the UI: per-electrode region labels.

Sidecar format (JSON):

```json
{
  "electrodes": [
    {"channel_id": 0, "ap": 0, "ml": 0, "region": "M2", "label": "ch0"},
    {"channel_id": 1, "ap": 0, "ml": 1, "region": "M1", "label": null}
  ]
}
```

Either ``channel_id`` OR ``(ap, ml)`` must be supplied; the loader keeps
whatever is present. ``region`` is the load-bearing field for G7; the
others are optional.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Electrode:
    """One electrode's region annotation."""

    region: str
    channel_id: int | None = None
    ap: int | None = None
    ml: int | None = None
    label: str | None = None


@dataclass(frozen=True)
class ProbeLayout:
    """Ordered tuple of electrode region annotations."""

    electrodes: tuple[Electrode, ...]

    @property
    def n_channels(self) -> int:
        return len(self.electrodes)


def load_probe_layout(path: Path) -> ProbeLayout:
    """Parse a probe-layout JSON sidecar.

    Raises ``ValueError`` if the file is malformed (missing ``electrodes``
    array, entries without a ``region`` field).
    """
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    raw_electrodes = data.get("electrodes")
    if not isinstance(raw_electrodes, list):
        raise ValueError(
            f"{path}: probe-layout sidecar must have an 'electrodes' array"
        )
    electrodes: list[Electrode] = []
    for idx, entry in enumerate(raw_electrodes):
        if not isinstance(entry, dict):
            raise ValueError(f"{path}: electrode #{idx} is not an object")
        region = entry.get("region")
        if not isinstance(region, str) or not region:
            raise ValueError(
                f"{path}: electrode #{idx} is missing a non-empty 'region' field"
            )
        channel_id = entry.get("channel_id")
        ap = entry.get("ap")
        ml = entry.get("ml")
        label = entry.get("label")
        electrodes.append(
            Electrode(
                region=region,
                channel_id=int(channel_id) if channel_id is not None else None,
                ap=int(ap) if ap is not None else None,
                ml=int(ml) if ml is not None else None,
                label=str(label) if label is not None else None,
            )
        )
    return ProbeLayout(electrodes=tuple(electrodes))


def find_probe_layout_sidecar(data_path: Path) -> Path | None:
    """Locate a ``probe_layout.json`` next to or inside ``data_path``.

    Returns ``None`` if no sidecar is found. Matches the same search
    pattern the CLI uses for ``brainstates.nc``.
    """
    candidate_dir = data_path if data_path.is_dir() else data_path.parent
    candidate = candidate_dir / "probe_layout.json"
    if candidate.is_file():
        return candidate
    return None
