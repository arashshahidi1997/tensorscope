"""Minimal TensorScope CLI for the extracted core package."""

from __future__ import annotations

import argparse
import sys

from tensorscope import __version__
from tensorscope.core.layout import LayoutManager


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
    return parser


def _cmd_presets() -> int:
    manager = LayoutManager()
    for name in manager.preset_names():
        preset = manager.get_preset(name)
        print(f"{preset.name}: {preset.description}")
    return 0


def _cmd_info() -> int:
    print(f"TensorScope {__version__}")
    print("Status: Phase 1 core extraction")
    print("UI/server migration layers are not implemented in this repo yet.")
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

    parser.print_help()
    raise SystemExit(0)


if __name__ == "__main__":
    main()
