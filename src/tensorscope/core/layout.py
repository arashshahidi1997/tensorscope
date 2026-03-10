"""
Layout management for TensorScope.

Defines layout presets as pure data descriptors — no UI dependencies.
Grid assignments are (r0, r1, c0, c1) tuples that a frontend or template
can interpret directly.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class LayoutPreset:
    """
    Layout preset configuration.

    grid_assignments maps panel_id -> (r0, r1, c0, c1).
    These are logical grid coordinates; the frontend maps them to CSS grid or
    Panel FastGridTemplate cells.
    """

    name: str
    description: str
    grid_assignments: dict[str, tuple[int, int, int, int]]
    sidebar_panels: list[str]


class LayoutManager:
    """
    Registry of named layout presets.

    Pure data — no Panel or UI dependencies. The frontend reads the active
    preset via the API and applies slot assignments itself.
    """

    def __init__(self, title: str = "TensorScope", theme: str = "dark"):
        self.title = str(title)
        self.theme = str(theme)
        self._current_preset = "default"

        self._presets: dict[str, LayoutPreset] = {
            "default": LayoutPreset(
                name="default",
                description="Spatial + navigator on top, timeseries bottom",
                grid_assignments={
                    "spatial_map": (0, 5, 0, 6),
                    "navigator": (0, 5, 6, 12),
                    "timeseries": (5, 10, 0, 12),
                },
                sidebar_panels=["selector", "processing"],
            ),
            "spatial_focus": LayoutPreset(
                name="spatial_focus",
                description="Large spatial map, small timeseries",
                grid_assignments={
                    "spatial_map": (0, 8, 0, 12),
                    "timeseries": (8, 10, 0, 12),
                },
                sidebar_panels=["selector", "processing", "navigator"],
            ),
            "timeseries_focus": LayoutPreset(
                name="timeseries_focus",
                description="Large timeseries, small spatial thumbnail",
                grid_assignments={
                    "spatial_map": (0, 3, 0, 4),
                    "navigator": (0, 3, 4, 12),
                    "timeseries": (3, 10, 0, 12),
                },
                sidebar_panels=["selector", "processing"],
            ),
            "psd_explorer": LayoutPreset(
                name="psd_explorer",
                description="PSD analysis with timeseries and spatial views",
                grid_assignments={
                    "timeseries": (0, 9, 0, 7),
                    "spatial_map": (0, 9, 7, 12),
                    "psd_explorer": (9, 14, 0, 12),
                    "navigator": (14, 16, 0, 12),
                },
                sidebar_panels=["selector", "processing", "psd_settings"],
            ),
        }

    def preset_names(self) -> list[str]:
        return sorted(self._presets.keys())

    def get_preset(self, preset_name: str) -> LayoutPreset:
        if preset_name not in self._presets:
            raise ValueError(
                f"Preset {preset_name!r} not found. Available: {sorted(self._presets.keys())}"
            )
        return self._presets[preset_name]

    def set_preset(self, preset_name: str) -> None:
        _ = self.get_preset(preset_name)  # validates name
        self._current_preset = preset_name

    def sidebar_panels_for(self, preset_name: str) -> list[str]:
        return list(self.get_preset(preset_name).sidebar_panels)

    @property
    def current_preset(self) -> str:
        return self._current_preset

    def to_dict(self) -> dict[str, Any]:
        preset = self.get_preset(self._current_preset)
        return {
            "title": self.title,
            "theme": self.theme,
            "current_preset": self._current_preset,
            "grid_assignments": preset.grid_assignments,
            "sidebar_panels": preset.sidebar_panels,
            "available_presets": self.preset_names(),
        }

    @classmethod
    def from_dict(cls, config: dict[str, Any]) -> "LayoutManager":
        manager = cls(
            title=config.get("title", "TensorScope"),
            theme=config.get("theme", "dark"),
        )
        manager._current_preset = config.get("current_preset", "default")
        return manager
