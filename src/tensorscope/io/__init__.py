"""I/O adapters for assembling TensorScope sessions from in-memory arrays.

Phase 0 of ``docs/design/neuropixels-multiprobe.md``: thin, pure helpers that
take already-loaded ``xr.DataArray``s (no file-format readers) and shape them
into a multi-tensor / multi-probe session dict ready for
``tensorscope.server.state.create_server_state``.
"""

from __future__ import annotations

from tensorscope.io.assemble import assemble_session, prepare_linear_probe
from tensorscope.io.events import load_events_manifest, split_manifest_dataframe
from tensorscope.io.tracks import brainstate_track_from_epochs, scalar_track_from_series

__all__ = [
    "assemble_session",
    "prepare_linear_probe",
    "load_events_manifest",
    "split_manifest_dataframe",
    "brainstate_track_from_epochs",
    "scalar_track_from_series",
]
