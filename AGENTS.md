# AGENTS.md

This file gives coding agents a compact, repo-specific operating guide for TensorScope.

## Purpose

TensorScope is a tensor-centric viewer for multidimensional neuroscience data. The backend serves sliced and transformed `xarray` tensors over FastAPI, and the frontend renders interactive views in React.

Use this file as the default working guide for changes in this repository. `CLAUDE.md` contains overlapping project notes and can be used as supporting context.

## Environment

- Python: `>=3.11`
- Preferred conda env from existing repo guidance: `cogpy`
- Backend imports rely on `PYTHONPATH=src`
- Demo dataset: `data/demo_lfp.nc`

Prefer these forms when running Python locally:

```bash
conda run -n cogpy python -m pytest tests -q
PYTHONPATH=src conda run -n cogpy python -m tensorscope.cli serve data/demo_lfp.nc
```

## Repo Map

- `src/tensorscope/cli.py`: CLI entry point, including `tensorscope serve`
- `src/tensorscope/core/`: pure Python core models and layout/schema/state helpers
- `src/tensorscope/server/`: FastAPI app, DTOs, session handling, request-to-slice logic
- `frontend/src/`: React + TypeScript UI, stores, query layer, view components
- `tests/`: backend and API tests
- `scripts/generate_demo_data.py`: deterministic demo dataset generator
- `data/`: local example data
- `resources/`: reference/vendor repos; avoid editing unless explicitly required
- `docs/`: research notes, prompts, and project docs

## Common Commands

Backend:

```bash
make test
PYTHONPATH=src conda run -n cogpy python -m pytest tests/test_server_api.py -q
PYTHONPATH=src conda run -n cogpy python -m tensorscope.cli serve data/demo_lfp.nc --host 127.0.0.1 --port 8000
```

Frontend:

```bash
cd frontend && npm run test
cd frontend && npm run build
cd frontend && npm run dev
```

Full stack:

```bash
make demo-data
make dev-ui
make ui-status
make kill-ui
```

Packaging:

```bash
make build
make check
```

## Architecture Notes

Backend:

- `server/app.py` builds the FastAPI app via `create_app(...)`
- `server/state.py` contains the request execution path, processed-tensor cache, and view registry logic
- `server/models.py` defines the API DTOs used between client and server
- The server slices tensors, serializes results to Arrow IPC, and returns base64-encoded payloads

Frontend:

- State is managed with Zustand stores in `frontend/src/store/`
- Data fetching goes through TanStack Query and the `api/` layer
- View definitions live in `frontend/src/registry/viewRegistry.ts`
- Main rendered views live in `frontend/src/components/views/`
- Layout shell and sidebar behavior live in `frontend/src/components/layout/`

## Working Conventions

- Keep backend logic in `src/tensorscope/core/` free of web/server concerns where practical.
- Match existing DTO and API patterns before introducing new response shapes.
- Prefer small, targeted changes over broad refactors.
- Preserve the existing slot-based layout behavior in the frontend unless the task explicitly changes layout semantics.
- Avoid editing generated or vendor-like content in `resources/` unless the task is specifically about those files.
- When changing behavior, update or add tests in the closest existing test file.

## Testing Expectations

- Backend changes: run the smallest relevant `pytest` target first, then broader coverage if needed.
- Frontend changes: run `npm run test` for behavioral logic and `npm run build` for type/build validation when relevant.
- If you cannot run a needed check, state that clearly in your handoff.

## Known Project-Specific Rules

- Error mapping convention: `KeyError -> 404`, `ValueError -> 400`
- `psd_live` depends on a `time` dimension and request-side PSD parameters
- Timeseries, navigator, and spectrogram flows expect `time_range`
- Multi-tensor sessions are supported via `dict[str, xr.DataArray]`
- Frontend uses Vite + Vitest; keep test config compatible with current setup
- React hooks must remain before any conditional early return

## Edit Hygiene

- Do not overwrite user changes you did not make.
- Prefer reading existing patterns before adding new abstractions.
- Keep comments brief and only where they remove real ambiguity.
- If you add a new command, workflow, or invariant that agents should follow, update this file.
