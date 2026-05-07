"""TensorScope — tensor-centric scientific data viewer."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

__version__ = "0.1.0"

__all__ = ["create_app", "__version__"]

if TYPE_CHECKING:
    from tensorscope.server import create_app  # noqa: F401


def __getattr__(name: str) -> Any:
    """Lazy attribute access — keeps ``tensorscope.pairing`` importable in
    thin-client envs that don't ship fastapi/uvicorn. Touching
    ``tensorscope.create_app`` only pulls the server stack on demand.
    """
    if name == "create_app":
        from tensorscope.server import create_app

        return create_app
    raise AttributeError(f"module 'tensorscope' has no attribute {name!r}")
