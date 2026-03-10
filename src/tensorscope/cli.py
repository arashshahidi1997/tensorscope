"""Minimal TensorScope CLI for the extracted core package."""

from __future__ import annotations

import argparse
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


def _load_dataarray(path: Path) -> xr.DataArray:
    try:
        return xr.load_dataarray(path)
    except Exception:
        dataset = xr.load_dataset(path)
        if len(dataset.data_vars) == 1:
            return next(iter(dataset.data_vars.values()))
        if "ieeg" in dataset.data_vars:
            return dataset["ieeg"]
        raise ValueError(f"Expected a single DataArray in {path}, found {list(dataset.data_vars)}")


def _cmd_serve(data_path: Path, tensor_name: str, host: str, port: int) -> int:
    data = _load_dataarray(data_path)
    app = create_app(data, tensor_name=tensor_name)
    uvicorn.run(app, host=str(host), port=int(port))
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
