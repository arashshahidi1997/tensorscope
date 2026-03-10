# TensorScope Phase 2 API

The Phase 2 backend exposes a versioned REST API under `/api/v1`.

## Session behavior

- Session state is per browser session, not global.
- A session is created lazily on the first API request.
- The server returns a `tensorscope_session_id` cookie and echoes the session id in `GET /api/v1/state`.
- Session state currently lives in memory only and expires after a TTL.

## Slice transport

- `POST /api/v1/tensors/{name}/slice` returns Arrow IPC payloads wrapped in JSON.
- The `payload` field is base64-encoded Arrow stream bytes.
- The response `meta` object includes coordinate summaries, axis labels, and downsampling metadata.

## Slice constraints

- Time-based slice requests must include `time_range`.
- Time-based slice requests must include `max_points`.
- Server-side downsampling is part of the contract, not an optional optimization.
- Supported downsampling values are `none`, `minmax`, and `lttb`.

## Realtime

- The planned realtime path is `/api/v1/ws/selection`.
- WebSocket selection sync is not implemented in Phase 2.
- Phase 2 clients should use the REST selection endpoints.
