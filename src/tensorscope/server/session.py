"""In-memory session manager for TensorScope server state."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from tensorscope.server.state import ServerState

SESSION_COOKIE_NAME = "tensorscope_session_id"


@dataclass
class SessionRecord:
    session_id: str
    state: ServerState
    expires_at: datetime


SHARED_SESSION_ID = "pair"


class SessionManager:
    """TTL-backed in-memory session storage."""

    def __init__(
        self,
        template_state: ServerState,
        *,
        ttl_seconds: int = 3600,
        pair_mode: bool = False,
    ):
        self._template_state = template_state
        self._ttl = timedelta(seconds=int(ttl_seconds))
        self._records: dict[str, SessionRecord] = {}
        self._pair_mode = bool(pair_mode)

    @property
    def pair_mode(self) -> bool:
        return self._pair_mode

    def get_or_create(self, session_id: str | None) -> tuple[str, ServerState, bool]:
        self.cleanup()

        if self._pair_mode:
            # All callers share one ServerState (no deepcopy). The cookie carries
            # a stable id so the browser keeps a stable session, but the state is
            # the same instance regardless of which cookie was presented.
            if SHARED_SESSION_ID not in self._records:
                self._records[SHARED_SESSION_ID] = SessionRecord(
                    session_id=SHARED_SESSION_ID,
                    state=self._template_state,
                    expires_at=self._deadline(),
                )
            record = self._records[SHARED_SESSION_ID]
            record.expires_at = self._deadline()
            created = session_id != SHARED_SESSION_ID
            return SHARED_SESSION_ID, record.state, created

        if session_id is not None and session_id in self._records:
            record = self._records[session_id]
            record.expires_at = self._deadline()
            return record.session_id, record.state, False

        new_id = uuid4().hex
        record = SessionRecord(
            session_id=new_id,
            state=deepcopy(self._template_state),
            expires_at=self._deadline(),
        )
        self._records[new_id] = record
        return record.session_id, record.state, True

    def cleanup(self) -> None:
        now = datetime.now(timezone.utc)
        expired = [sid for sid, record in self._records.items() if record.expires_at <= now]
        for sid in expired:
            self._records.pop(sid, None)

    def _deadline(self) -> datetime:
        return datetime.now(timezone.utc) + self._ttl
