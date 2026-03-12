"""Minimal transform cache for derived tensors.

Stores computed results keyed by provenance hash.  Actual disk
persistence and eviction tiers are deferred to M5.
"""

from __future__ import annotations

from typing import Any

from tensorscope.core.transforms.model import DerivedTensor


class TransformCache:
    """In-memory cache for computed derived tensors.

    Cache keys are derived from ``DerivedTensor.cache_key`` (provenance hash).
    """

    def __init__(self, max_entries: int = 128) -> None:
        self._store: dict[str, DerivedTensor] = {}
        self._max_entries = max_entries

    def get(self, cache_key: str) -> DerivedTensor | None:
        """Return cached tensor or None."""
        return self._store.get(cache_key)

    def put(self, tensor: DerivedTensor) -> None:
        """Store a computed tensor. Evicts oldest entry if at capacity."""
        if tensor.cache_key is None:
            return
        if len(self._store) >= self._max_entries and tensor.cache_key not in self._store:
            oldest_key = next(iter(self._store))
            del self._store[oldest_key]
        self._store[tensor.cache_key] = tensor

    def has(self, cache_key: str) -> bool:
        return cache_key in self._store

    def invalidate(self, cache_key: str) -> None:
        """Remove a specific entry."""
        self._store.pop(cache_key, None)

    def clear(self) -> None:
        """Remove all cached entries."""
        self._store.clear()

    def keys(self) -> list[str]:
        return list(self._store.keys())

    def __len__(self) -> int:
        return len(self._store)
