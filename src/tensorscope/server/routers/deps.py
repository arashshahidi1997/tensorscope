"""Shared router dependencies."""

from __future__ import annotations

from fastapi import Depends, Request, Response

from tensorscope.server.session import SESSION_COOKIE_NAME, SessionManager
from tensorscope.server.state import ServerState


def get_server_state(request: Request, response: Response) -> tuple[str, ServerState]:
    """Resolve or create the current session state and set the session cookie."""
    manager: SessionManager = request.app.state.session_manager
    cookie_session_id = request.cookies.get(SESSION_COOKIE_NAME)
    session_id, state, created = manager.get_or_create(cookie_session_id)
    if created or cookie_session_id != session_id:
        response.set_cookie(
            key=SESSION_COOKIE_NAME,
            value=session_id,
            httponly=True,
            samesite="lax",
        )
    return session_id, state


SessionState = tuple[str, ServerState]
SessionStateDep = Depends(get_server_state)
