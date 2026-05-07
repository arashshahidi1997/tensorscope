"""Wire format for runtime tensor / event injection.

Tensors travel as a JSON envelope with base64-encoded numpy bytes for the
data array and each coordinate. This preserves dims, dtypes, coords, and
attrs without requiring a NetCDF backend on either end.

Event streams travel as base64-encoded parquet bytes — pandas-native and
dtype-preserving.
"""

from __future__ import annotations

import base64
from io import BytesIO
from typing import Any

import numpy as np
import pandas as pd
import xarray as xr


def _array_to_payload(arr: np.ndarray) -> dict[str, Any]:
    contiguous = np.ascontiguousarray(arr)
    return {
        "dtype": str(contiguous.dtype),
        "shape": [int(s) for s in contiguous.shape],
        "data_b64": base64.b64encode(contiguous.tobytes()).decode("ascii"),
    }


def _payload_to_array(payload: dict[str, Any]) -> np.ndarray:
    raw = base64.b64decode(payload["data_b64"])
    arr = np.frombuffer(raw, dtype=np.dtype(payload["dtype"]))
    shape = tuple(int(s) for s in payload["shape"])
    return arr.reshape(shape)


def _coerce_attr(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, (list, tuple)):
        return [_coerce_attr(v) for v in value]
    if isinstance(value, dict):
        return {str(k): _coerce_attr(v) for k, v in value.items()}
    if isinstance(value, np.generic):
        return value.item()
    return str(value)


def dataarray_to_payload(da: xr.DataArray) -> dict[str, Any]:
    coords: dict[str, Any] = {}
    for name, coord in da.coords.items():
        coords[str(name)] = {
            "dims": [str(d) for d in coord.dims],
            **_array_to_payload(np.asarray(coord.values)),
        }
    return {
        "dims": [str(d) for d in da.dims],
        "data": _array_to_payload(np.asarray(da.values)),
        "coords": coords,
        "attrs": {str(k): _coerce_attr(v) for k, v in da.attrs.items()},
    }


def payload_to_dataarray(payload: dict[str, Any]) -> xr.DataArray:
    dims = tuple(str(d) for d in payload["dims"])
    data = _payload_to_array(payload["data"])
    coords: dict[str, Any] = {}
    for name, c in (payload.get("coords") or {}).items():
        coord_arr = _payload_to_array(c)
        coord_dims = tuple(str(d) for d in (c.get("dims") or (name,)))
        coords[name] = (coord_dims, coord_arr)
    return xr.DataArray(data, dims=dims, coords=coords, attrs=payload.get("attrs") or {})


def dataframe_to_b64(df: pd.DataFrame) -> str:
    """Encode a DataFrame as base64-wrapped parquet."""
    buf = BytesIO()
    df.to_parquet(buf, index=False)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def b64_to_dataframe(payload: str) -> pd.DataFrame:
    return pd.read_parquet(BytesIO(base64.b64decode(payload)))
