"""Agent-pairing API for TensorScope.

Lets a Python agent inject tensors / event streams and read or mutate
selection on a running tensorscope (started with ``--pair``). The browser
session reflects the changes in real time via SSE.

See ``docs/log/idea/idea-arash-20260507-160104-478773.md`` for the design.
"""

from __future__ import annotations

from tensorscope.pairing.client import PairContext, get_context

__all__ = ["PairContext", "get_context"]
