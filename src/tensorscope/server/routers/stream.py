"""Server-Sent Events stream for state diffs (agent-pairing v1)."""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from tensorscope.server.routers.deps import SessionState, SessionStateDep

router = APIRouter(prefix="/stream", tags=["stream"])

_HEARTBEAT_SECONDS = 15.0


@router.get("")
async def event_stream(request: Request, session: SessionState = SessionStateDep) -> StreamingResponse:
    """Stream state-change events to subscribers (browser or agent).

    Emits ``data: {"type": ..., "payload": ...}\\n\\n`` for each diff. A
    ``: heartbeat`` comment is sent every ~15 s so proxies don't reap the
    connection during quiet periods.
    """
    _, state = session
    queue: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_running_loop()
    sub = state.subscribe(queue, loop)

    async def _gen():
        try:
            yield ": connected\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=_HEARTBEAT_SECONDS)
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
                    continue
                yield f"data: {json.dumps(msg, default=str)}\n\n"
        finally:
            state.unsubscribe(sub)

    return StreamingResponse(
        _gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
