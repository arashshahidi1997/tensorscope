# TensorScope Frontend Phase 3

This repo now includes a manual React + Vite + TypeScript scaffold in `frontend/`.

## Current scope

- Reads `/api/v1/state`, `/api/v1/tensors/{name}`, `/api/v1/layout`, and slice endpoints
- Uses Zustand for local UI draft state
- Uses TanStack Query for API orchestration
- Decodes Arrow IPC slice payloads in the browser via `apache-arrow`
- Renders a placeholder slice table instead of the final chart components

## Structure

- `frontend/src/api/`: DTOs, fetch client, Arrow decoding, query helpers
- `frontend/src/store/`: Zustand UI store
- `frontend/src/components/`: layout shell, controls, placeholder views
- `frontend/src/registry/`: view registry keyed by server view type

## Intended next step

Replace the placeholder slice renderer with the first real canonical views:

- `timeseries` -> dense waveform renderer
- `spatial_map` -> electrode grid renderer

The current scaffold is intentionally API-first and renderer-agnostic.
