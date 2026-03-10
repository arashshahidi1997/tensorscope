"""Registry for multiple TensorScope event streams."""

from __future__ import annotations

from tensorscope.core.events.model import EventStream


class EventRegistry:
    """Manage named EventStream instances."""

    def __init__(self) -> None:
        self._streams: dict[str, EventStream] = {}

    def register(self, stream: EventStream) -> None:
        self._streams[str(stream.name)] = stream

    def get(self, name: str) -> EventStream | None:
        return self._streams.get(str(name))

    def list(self) -> list[str]:
        return sorted(self._streams.keys())

    def remove(self, name: str) -> None:
        self._streams.pop(str(name), None)

    def to_dict(self) -> dict:
        return {"streams": {name: stream.to_dict() for name, stream in self._streams.items()}}

    @classmethod
    def from_dict(cls, payload: dict) -> "EventRegistry":
        registry = cls()
        streams = (payload or {}).get("streams") or {}
        if not isinstance(streams, dict):
            return registry

        for name, stream_payload in streams.items():
            try:
                candidate = stream_payload if isinstance(stream_payload, dict) else {"name": name}
                candidate = {**candidate, "name": str(name)}
                registry.register(EventStream.from_dict(candidate))
            except Exception:
                continue
        return registry
