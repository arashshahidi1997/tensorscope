"""TensorScope — tensor-centric scientific data viewer."""

__version__ = "0.1.0"

from tensorscope.server import create_app

__all__ = ["create_app", "__version__"]
