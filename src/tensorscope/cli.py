"""Minimal TensorScope CLI for the extracted core package."""

from __future__ import annotations

import argparse
import socket
import sys
from pathlib import Path

import xarray as xr
import uvicorn

from tensorscope import __version__
from tensorscope.core.layout import LayoutManager
from tensorscope.server.app import create_app


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="tensorscope", description="TensorScope core tools")
    parser.add_argument(
        "--version",
        action="store_true",
        help="Print TensorScope version and exit.",
    )

    sub = parser.add_subparsers(dest="cmd", required=False)
    sub.add_parser("presets", help="List available layout presets")
    sub.add_parser("info", help="Show package status")
    serve = sub.add_parser("serve", help="Launch the Phase 2 API for a NetCDF DataArray")
    serve.add_argument("data_path", type=Path, help="Path to a NetCDF data array or dataset")
    serve.add_argument("--tensor-name", default="signal", help="Registered tensor name")
    serve.add_argument("--host", default="127.0.0.1", help="Bind host")
    serve.add_argument("--port", type=int, default=8000, help="Bind port")
    return parser


def _cmd_presets() -> int:
    manager = LayoutManager()
    for name in manager.preset_names():
        preset = manager.get_preset(name)
        print(f"{preset.name}: {preset.description}")
    return 0


def _cmd_info() -> int:
    print(f"TensorScope {__version__}")
    print("Status: Phase 2 API contract implemented")
    print("Frontend migration is not implemented in this repo yet.")
    return 0


def _load_lfp(path: Path) -> xr.DataArray:
    """Load a raw .lfp binary file using cogpy's BIDS iEEG loader."""
    from cogpy.io import ieeg_io

    print(f"Loading LFP binary: {path}")
    da = ieeg_io.from_file(path, grid=True, as_float=True)
    # ieeg_io returns dask-backed; compute into memory for the server.
    # Use float32 to halve memory usage on large recordings.
    da = da.astype("float32").compute()
    print(f"  shape={da.shape}, dims={da.dims}")
    return da


def _load_dataarray(path: Path) -> xr.DataArray:
    # Handle raw .lfp / .dat binary files with BIDS sidecars
    if path.suffix in (".lfp", ".dat"):
        return _load_lfp(path)

    # If path is a directory, look for a .lfp or .nc file inside
    if path.is_dir():
        lfp_files = list(path.glob("*.lfp"))
        if lfp_files:
            return _load_lfp(lfp_files[0])
        nc_files = list(path.glob("*.nc"))
        if nc_files:
            path = nc_files[0]
        else:
            raise ValueError(f"No .lfp or .nc files found in {path}")

    try:
        return xr.load_dataarray(path)
    except Exception:
        dataset = xr.load_dataset(path)
        if len(dataset.data_vars) == 1:
            return next(iter(dataset.data_vars.values()))
        if "ieeg" in dataset.data_vars:
            return dataset["ieeg"]
        raise ValueError(f"Expected a single DataArray in {path}, found {list(dataset.data_vars)}")


def _load_nc_as_dataarray(path: Path) -> xr.DataArray:
    """Load a .nc file as a DataArray, handling both DataArray and single-var Dataset."""
    try:
        return xr.load_dataarray(path)
    except Exception:
        ds = xr.load_dataset(path)
        if len(ds.data_vars) == 1:
            return next(iter(ds.data_vars.values()))
        raise ValueError(f"Expected a single DataArray in {path}, found {list(ds.data_vars)}")


def _load_brainstates(data_path: Path) -> xr.DataArray | None:
    """Try to load brainstates from a sibling file or parent directory."""
    # If data_path is a directory, look for brainstates.nc inside it
    if data_path.is_dir():
        bs_path = data_path / "brainstates.nc"
    else:
        # Look for brainstates.nc next to the data file
        bs_path = data_path.parent / "brainstates.nc"
    if bs_path.exists():
        try:
            return _load_nc_as_dataarray(bs_path)
        except Exception:
            pass
    return None


def _load_events(data_path: Path) -> EventRegistry | None:
    """Try to load events from parquet files in the data directory."""
    import pandas as pd

    from tensorscope.core.events import EventRegistry, EventStream

    search_dir = data_path if data_path.is_dir() else data_path.parent
    parquet_files = sorted(search_dir.glob("*.parquet"))
    if not parquet_files:
        return None

    registry = EventRegistry()
    for pf in parquet_files:
        try:
            df = pd.read_parquet(pf)
            name = pf.stem  # e.g. "events" from "events.parquet"
            # Detect time column
            time_col = "t" if "t" in df.columns else "time" if "time" in df.columns else None
            if time_col is None:
                continue
            # Ensure event_id column exists
            if "event_id" not in df.columns:
                df["event_id"] = range(len(df))
            registry.register(EventStream(name, df, time_col=time_col))
            print(f"Loaded events: {name} ({len(df)} events from {pf.name})")
        except Exception as exc:
            print(f"Warning: could not load events from {pf.name}: {exc}")
    return registry if registry.list() else None


def _load_bundle(data_path: Path) -> tuple[dict[str, xr.DataArray], xr.DataArray | None, EventRegistry | None]:
    """Load a directory as a TensorScope bundle.

    Returns (tensors_dict, brainstates, events_registry).
    """
    tensors: dict[str, xr.DataArray] = {}

    # Load all .nc files except brainstates
    for nc_file in sorted(data_path.glob("*.nc")):
        if nc_file.stem == "brainstates":
            continue
        try:
            da = _load_nc_as_dataarray(nc_file)
            name = nc_file.stem
            tensors[name] = da
            print(f"Loaded tensor: {name} {da.dims} {da.shape}")
        except Exception as exc:
            print(f"Warning: could not load {nc_file.name}: {exc}")

    if not tensors:
        raise ValueError(f"No .nc tensor files found in {data_path}")

    brainstates = _load_brainstates(data_path)
    events = _load_events(data_path)

    return tensors, brainstates, events


def _port_is_available(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((host, port))
        except OSError:
            return False
    return True


def _choose_port(host: str, preferred_port: int, max_attempts: int = 100) -> int:
    if preferred_port == 0:
        return 0
    for port in range(preferred_port, preferred_port + max_attempts):
        if _port_is_available(host, port):
            return port
    raise OSError(
        f"Could not find an available port on {host} in range "
        f"{preferred_port}-{preferred_port + max_attempts - 1}"
    )


def _cmd_serve(data_path: Path, tensor_name: str, host: str, port: int) -> int:
    if data_path.is_dir():
        tensors, brainstates, events = _load_bundle(data_path)
        if brainstates is not None:
            print(f"Loaded brainstates: {brainstates.dims} {brainstates.shape}")
        app = create_app(tensors, tensor_name=tensor_name, events_registry=events, brainstates=brainstates)
    else:
        data = _load_dataarray(data_path)
        brainstates = _load_brainstates(data_path)
        events = _load_events(data_path)
        if brainstates is not None:
            print(f"Loaded brainstates: {brainstates.dims} {brainstates.shape}")
        app = create_app(data, tensor_name=tensor_name, events_registry=events, brainstates=brainstates)
    chosen_port = _choose_port(str(host), int(port))
    if chosen_port != int(port):
        print(f"Port {port} is in use on {host}; using {chosen_port} instead.")
    uvicorn.run(app, host=str(host), port=chosen_port)
    return 0


def main(argv: list[str] | None = None) -> None:
    args = sys.argv[1:] if argv is None else argv
    parser = _build_parser()
    ns = parser.parse_args(args)

    if ns.version:
        print(__version__)
        raise SystemExit(0)

    if ns.cmd == "presets":
        raise SystemExit(_cmd_presets())
    if ns.cmd == "info":
        raise SystemExit(_cmd_info())
    if ns.cmd == "serve":
        raise SystemExit(
            _cmd_serve(
                data_path=ns.data_path,
                tensor_name=str(ns.tensor_name),
                host=str(ns.host),
                port=int(ns.port),
            )
        )

    parser.print_help()
    raise SystemExit(0)


if __name__ == "__main__":
    main()
