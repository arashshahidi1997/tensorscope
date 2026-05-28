"""Event-review decision export/import (G9).

Persists the reviewer's per-event ``accepted | rejected | maybe`` decisions
to a sidecar parquet (csv fallback) next to the dataset so 4 hours of
work survives more than the browser's localStorage.

Output path::

    <dataset_dir>/review/<stream>__decisions.parquet

Writes are atomic (write to ``.tmp`` then ``rename``) so a crash mid-write
cannot corrupt an existing file.
"""

from __future__ import annotations

import logging
import os
import re
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

from tensorscope.server.models import (
    ApiErrorDTO,
    EventDecisionBatchDTO,
    EventDecisionDTO,
    EventDecisionExportResponseDTO,
    EventDecisionListDTO,
)
from tensorscope.server.routers.deps import SessionState, SessionStateDep

router = APIRouter(prefix="/events", tags=["events"])

logger = logging.getLogger(__name__)


_SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._-]+")


def _safe_stream(name: str) -> str:
    """Normalise a stream name to something safe for a filename.

    Strip directory separators and exotic characters — we only want the
    stream component to vary, never to escape ``review/``.
    """
    cleaned = _SAFE_NAME_RE.sub("_", name).strip("._")
    if not cleaned:
        raise HTTPException(status_code=400, detail="empty or invalid stream name")
    return cleaned


def _review_dir(dataset_dir: Path | None) -> Path:
    if dataset_dir is None:
        raise HTTPException(
            status_code=403,
            detail=(
                "Server was started without a dataset directory — review "
                "decisions cannot be saved to disk. Restart with a path-based "
                "dataset, or use --write-dir (TBD)."
            ),
        )
    target = dataset_dir / "review"
    return target


def _decisions_path(dataset_dir: Path | None, stream: str) -> tuple[Path, Path]:
    """Return ``(parquet_path, csv_path)`` for the given stream.

    Both are returned so GET can transparently fall back if only the CSV
    sidecar exists.
    """
    base = _review_dir(dataset_dir)
    safe = _safe_stream(stream)
    return base / f"{safe}__decisions.parquet", base / f"{safe}__decisions.csv"


def _ensure_writable(target_dir: Path) -> None:
    """Create ``target_dir`` if needed, raise 403 if it cannot be written.

    We surface a clear 403 rather than a generic 500 — the spec calls this
    out for read-only bundles.
    """
    try:
        target_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise HTTPException(
            status_code=403,
            detail=f"dataset directory is not writable: {exc}",
        )
    if not os.access(target_dir, os.W_OK):
        raise HTTPException(
            status_code=403,
            detail=f"dataset directory is not writable: {target_dir}",
        )


def _decisions_to_rows(decisions: list[EventDecisionDTO]) -> list[dict[str, Any]]:
    rows = []
    for d in decisions:
        rows.append({
            "event_id": d.event_id,
            "status": d.status,
            "decided_at": int(d.decided_at),
            "notes": d.notes,
            "tags": list(d.tags),
        })
    return rows


def _rows_to_decisions(rows: list[dict[str, Any]]) -> list[EventDecisionDTO]:
    import numpy as np

    out: list[EventDecisionDTO] = []
    for row in rows:
        tags_raw = row.get("tags")
        # parquet round-trips list-typed columns as numpy ndarrays of objects,
        # not as python lists — accept any non-string iterable here so the
        # written tags don't silently dissolve into [] on read-back.
        if tags_raw is None:
            tags: list[str] = []
        elif isinstance(tags_raw, str):
            # csv path encodes tags as a JSON string; parse defensively.
            try:
                import json
                parsed = json.loads(tags_raw)
                tags = [str(t) for t in parsed] if isinstance(parsed, list) else []
            except (TypeError, ValueError):
                tags = []
        elif isinstance(tags_raw, (list, tuple, np.ndarray)):
            tags = [str(t) for t in tags_raw]
        elif hasattr(tags_raw, "__iter__"):
            tags = [str(t) for t in tags_raw]
        else:
            tags = []
        notes = row.get("notes")
        # pandas/parquet store `None` as NaN in object columns. Coerce BEFORE
        # any `str()` — otherwise we'd hand back the string `"nan"`.
        if notes is None or (isinstance(notes, float) and notes != notes):
            notes = None
        elif not isinstance(notes, str):
            notes = str(notes)
        out.append(
            EventDecisionDTO(
                event_id=row["event_id"],
                status=row["status"],
                decided_at=int(row["decided_at"]),
                notes=notes,
                tags=tags,
            )
        )
    return out


def _atomic_write(rows: list[dict[str, Any]], target: Path) -> str:
    """Write ``rows`` to ``target`` (parquet preferred, csv fallback).

    Returns the format actually written (``"parquet"`` or ``"csv"``).
    Both paths use a sibling ``.tmp`` file and ``os.replace`` so an
    interrupted write never replaces a good file with a partial one.
    """
    import pandas as pd

    df = pd.DataFrame(rows, columns=["event_id", "status", "decided_at", "notes", "tags"])
    tmp = target.with_suffix(target.suffix + ".tmp")
    try:
        df.to_parquet(tmp, index=False)
        os.replace(tmp, target)
        return "parquet"
    except Exception as exc:  # noqa: BLE001
        logger.warning("parquet write failed, falling back to csv: %s", exc)
        # Clean up any partial parquet tmp.
        try:
            tmp.unlink()
        except FileNotFoundError:
            pass
        csv_target = target.with_suffix(".csv")
        csv_tmp = csv_target.with_suffix(csv_target.suffix + ".tmp")
        # Encode tags as JSON for round-trippability in csv.
        import json
        df_csv = df.copy()
        df_csv["tags"] = df_csv["tags"].apply(json.dumps)
        df_csv.to_csv(csv_tmp, index=False)
        os.replace(csv_tmp, csv_target)
        # A previously-successful parquet write would now shadow this fresh
        # csv: _read_existing checks parquet first. Remove the stale parquet
        # so subsequent reads resolve to the csv we just wrote.
        try:
            target.unlink()
        except FileNotFoundError:
            pass
        return "csv"


def _read_existing(parquet_path: Path, csv_path: Path) -> tuple[
    list[EventDecisionDTO], Path | None, str | None, int | None,
]:
    """Load existing decisions from disk if any. Returns (decisions, path, format, mtime_ms)."""
    import pandas as pd

    chosen: Path | None = None
    fmt: str | None = None
    if parquet_path.exists():
        chosen, fmt = parquet_path, "parquet"
        df = pd.read_parquet(parquet_path)
    elif csv_path.exists():
        chosen, fmt = csv_path, "csv"
        df = pd.read_csv(csv_path)
    else:
        return [], None, None, None
    rows = df.to_dict(orient="records")
    decisions = _rows_to_decisions(rows)
    mtime_ms = int(chosen.stat().st_mtime * 1000)
    return decisions, chosen, fmt, mtime_ms


@router.post(
    "/{stream_name}/decisions",
    response_model=EventDecisionExportResponseDTO,
    responses={
        400: {"model": ApiErrorDTO},
        403: {"model": ApiErrorDTO},
        404: {"model": ApiErrorDTO},
    },
)
def export_event_decisions(
    stream_name: str,
    body: EventDecisionBatchDTO,
    session: SessionState = SessionStateDep,
) -> EventDecisionExportResponseDTO:
    """Persist reviewer decisions to a sidecar parquet.

    The endpoint is idempotent — it always overwrites the existing file
    atomically. The frontend is expected to send the full set of
    decisions for ``(tensor, stream)``, not a delta.
    """
    _, state = session

    # Verify the stream actually exists — saving decisions for a missing
    # stream is almost always a bug; surface it as 404.
    if state.get_event_stream(stream_name) is None:
        raise HTTPException(
            status_code=404, detail=f"event stream {stream_name!r} not found"
        )

    parquet_path, _csv_path = _decisions_path(state.dataset_dir, stream_name)
    _ensure_writable(parquet_path.parent)

    rows = _decisions_to_rows(body.decisions)
    fmt = _atomic_write(rows, parquet_path)
    written_path = parquet_path if fmt == "parquet" else parquet_path.with_suffix(".csv")
    saved_at = int(time.time() * 1000)

    return EventDecisionExportResponseDTO(
        stream=stream_name,
        path=str(written_path),
        format=fmt,  # type: ignore[arg-type]
        n_decisions=len(body.decisions),
        saved_at=saved_at,
    )


@router.get(
    "/{stream_name}/decisions",
    response_model=EventDecisionListDTO,
    responses={404: {"model": ApiErrorDTO}, 403: {"model": ApiErrorDTO}},
)
def get_event_decisions(
    stream_name: str,
    session: SessionState = SessionStateDep,
) -> EventDecisionListDTO:
    """Return previously-saved decisions for ``stream_name``.

    A fresh dataset with no exported decisions returns an empty list and
    null timestamp — the frontend treats this as "nothing on disk yet"
    rather than an error.
    """
    _, state = session

    if state.get_event_stream(stream_name) is None:
        raise HTTPException(
            status_code=404, detail=f"event stream {stream_name!r} not found"
        )

    if state.dataset_dir is None:
        # GET is informational — return empty rather than 403 so the
        # frontend can render its status row without special-casing the
        # in-memory case.
        return EventDecisionListDTO(stream=stream_name, decisions=[])

    parquet_path, csv_path = _decisions_path(state.dataset_dir, stream_name)
    decisions, chosen, fmt, mtime_ms = _read_existing(parquet_path, csv_path)
    return EventDecisionListDTO(
        stream=stream_name,
        decisions=decisions,
        path=str(chosen) if chosen is not None else None,
        format=fmt,  # type: ignore[arg-type]
        saved_at=mtime_ms,
    )
