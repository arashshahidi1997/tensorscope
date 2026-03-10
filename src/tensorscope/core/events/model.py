"""Event stream data model for TensorScope."""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd


@dataclass(frozen=True, slots=True)
class EventStyle:
    """Visual styling metadata for an event stream."""

    color: str = "#ff0000"
    marker: str = "circle"
    line_width: float = 2.0
    alpha: float = 0.8


class EventStream:
    """Container for timestamped event data."""

    def __init__(
        self,
        name: str,
        df: pd.DataFrame,
        *,
        time_col: str = "t",
        id_col: str = "event_id",
        style: EventStyle | None = None,
    ):
        if time_col not in df.columns:
            raise ValueError(f"DataFrame must have {time_col!r} column")
        if id_col not in df.columns:
            raise ValueError(f"DataFrame must have {id_col!r} column")

        self.name = str(name)
        self.time_col = str(time_col)
        self.id_col = str(id_col)
        self.style = style or EventStyle()
        self.df = df.copy().sort_values(self.time_col).reset_index(drop=True)

    def get_events_in_window(self, t0: float, t1: float) -> pd.DataFrame:
        lo = float(t0)
        hi = float(t1)
        if hi < lo:
            lo, hi = hi, lo
        mask = (self.df[self.time_col] >= lo) & (self.df[self.time_col] <= hi)
        return self.df[mask]

    def get_event_by_id(self, event_id: object) -> pd.Series | None:
        events = self.df[self.df[self.id_col] == event_id]
        if len(events) > 0:
            return events.iloc[0]
        return None

    def get_next_event(self, current_time: float) -> pd.Series | None:
        events = self.df[self.df[self.time_col] > float(current_time)]
        if len(events) > 0:
            return events.iloc[0]
        return None

    def get_prev_event(self, current_time: float) -> pd.Series | None:
        events = self.df[self.df[self.time_col] < float(current_time)]
        if len(events) > 0:
            return events.iloc[-1]
        return None

    def __len__(self) -> int:
        return len(self.df)

    def to_dict(self) -> dict:
        max_records = 20000
        records = self.df.to_dict(orient="records") if len(self.df) <= max_records else None

        t_min = float(self.df[self.time_col].min()) if len(self.df) else None
        t_max = float(self.df[self.time_col].max()) if len(self.df) else None
        return {
            "name": self.name,
            "time_col": self.time_col,
            "id_col": self.id_col,
            "n_events": len(self.df),
            "time_range": (t_min, t_max),
            "records": records,
            "style": {
                "color": self.style.color,
                "marker": self.style.marker,
                "alpha": self.style.alpha,
                "line_width": self.style.line_width,
            },
        }

    @classmethod
    def from_dict(cls, payload: dict) -> "EventStream":
        name = str(payload.get("name", "events"))
        time_col = str(payload.get("time_col", "t"))
        id_col = str(payload.get("id_col", "event_id"))
        records = payload.get("records") or []

        try:
            df = pd.DataFrame.from_records(records)
        except Exception:
            df = pd.DataFrame()

        for col in (id_col, time_col):
            if col not in df.columns:
                df[col] = []

        style_payload = payload.get("style") or {}
        style = EventStyle(
            color=str(style_payload.get("color", EventStyle.color)),
            marker=str(style_payload.get("marker", EventStyle.marker)),
            line_width=float(style_payload.get("line_width", EventStyle.line_width)),
            alpha=float(style_payload.get("alpha", EventStyle.alpha)),
        )
        return cls(name, df, time_col=time_col, id_col=id_col, style=style)
