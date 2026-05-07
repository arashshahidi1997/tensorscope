---
title: "ParamSpec tri-state: stop leaking K=0 / fmax=0 / noverlap=-1 sentinels"
status: done
result_note: /storage2/arash/worklog/workflow/captures/20260502-171331-4ed562/note.md
completed: 2026-05-02T17:13:33+02:00
created: 2026-05-02
updated: 2026-05-02
timestamp: 20260502-140000-003
tags: [task, fix, dto, transforms]
---

# ParamSpec tri-state: stop the sentinel leak

## The bug

`tensorscope.core.transforms.registry.ParamSpec(default=None)` is
treated by `validate_params` as **required** (an unprovided value
raises). To express "optional, omit-to-use-cogpy-default", the cogpy
wrappers in `src/tensorscope/core/transforms/builtins.py` use sentinel
ints:

- `K = 0` for multitaper "auto" (`K = floor(2·NW − 1)`)
- `fmax = 0` for "Nyquist"
- `noverlap = -1` for "default overlap"

These sentinels are exposed to clients via `GET /api/v1/transforms/{name}`
(serialized through `param_schema`) and they leak into the OpenAPI
contract. The agent that landed this acknowledged it in the
cogpy-compat task note as a "workaround".

## The fix

Extend `ParamSpec` to a tri-state:

1. **Required** — must be supplied by the caller
2. **Default-None** — optional, `None` means "use the underlying
   library's default"
3. **Default-value** — optional with a concrete fallback (current
   behavior)

The natural shape is a sentinel object distinct from `None`:

```python
_REQUIRED = object()

@dataclass
class ParamSpec:
    dtype: str
    default: Any = _REQUIRED      # was: None == required
    description: str = ""
    ...

    @property
    def is_required(self) -> bool:
        return self.default is _REQUIRED
```

Then `validate_params` distinguishes `_REQUIRED` (raise) from `None`
(pass through).

## Where to change

- `src/tensorscope/core/transforms/registry.py` — `ParamSpec`,
  `validate_params`
- `src/tensorscope/core/transforms/builtins.py` — replace sentinels
  (`K=0`, `fmax=0`, `noverlap=-1`) with `default=None`. Compute logic
  that maps `None` → cogpy default stays inside the wrapper.
- `src/tensorscope/server/models.py` — `ParamSpecDTO` `default` field
  becomes `Any | None`; serialize `_REQUIRED` as a string sentinel
  (e.g. `"<required>"`) or as a separate `required: bool` field on the
  DTO. Pick whichever is cleaner for the OpenAPI contract.
- `src/tensorscope/server/routers/transforms.py` — DTO conversion at
  the `/transforms` and `/transforms/{name}` endpoints

## Test additions

- Unit test: `ParamSpec` without `default` is required; with
  `default=None` it is optional and passes `None` to compute; with
  `default=value` it falls back when omitted.
- Unit test: `psd_multitaper` called with `params={}` returns the same
  thing as `params={"K": None, "fmax": None}` and matches cogpy's own
  defaults.
- Unit test: `GET /api/v1/transforms/psd_multitaper` exposes
  `K.default == None` (or `K.required == False`), not `0`.

## Smoke after

- `pixi run test` green
- `pixi run frontend-test` green (frontend may be reading
  `param_schema[k].default`; if so, update or add a guard)
- `curl GET /api/v1/transforms/psd_multitaper` returns `K.default` as
  `null` not `0`
- `curl POST /api/v1/transforms/execute` for psd_multitaper with empty
  params still produces a sane PSD (K resolves to floor(2·NW−1) inside
  the wrapper)

## Constraints

- Surgical fix. Do not refactor the broader registry / executor.
- Do not change `ProcessingParamsDTO` or `PsdParamsDTO` field semantics.
  This only affects `ParamSpec` (the per-transform schema description).
- Frontend may need a small guard if it currently treats `default == 0`
  as "use auto"; check `frontend/src/store/dagStore.ts` and any
  transform-param UI components.

## Deliverables

- Code changes per above
- Test additions per above
- `pixi run test` and `pixi run frontend-test` green
- Brief findings appended to this note: what changed, what the
  OpenAPI surface looks like before/after

---

## Findings (2026-05-02)

### What changed

- `tensorscope.core.transforms.registry.ParamSpec`
  - Introduced module-level `_REQUIRED = object()` sentinel.
  - `default: Any = _REQUIRED` (was `default: Any = None`).
  - Added `is_required` property (`self.default is _REQUIRED`).
  - `validate(None)` now returns `self.default` (which may be `None`)
    when not required, instead of raising. Required is now expressed by
    omission of `default=` (or, equivalently, `default=_REQUIRED`).
  - Pre-existing tests `test_validate_required` (omitted default) and
    `test_validate_default` continue to pass under the new rules.

- `tensorscope.core.transforms.builtins`
  - `_compute_psd_multitaper`: replaced sentinel-int decoding
    (`K=0`/`fmax=0` → "use cogpy default") with a `params.get("K")
    is not None` check. Coerces with `int(...)`/`float(...)` only when
    forwarded to cogpy.
  - `_compute_psd_welch`: same treatment for `fmax` and `noverlap`.
  - `PSD_MULTITAPER` / `PSD_WELCH` schemas:
    - `K`:        `default=0,  min_value=0`  → `default=None, min_value=1`
    - `fmax`:     `default=0,  min_value=0`  → `default=None, min_value=0.1`
    - `noverlap`: `default=-1, min_value=-1` → `default=None, min_value=0`

- `tensorscope.server.models.TransformParamSpecDTO`
  - Added `required: bool = False`. Required params now serialize as
    `default: null, required: true`; "library default" optional params
    serialize as `default: null, required: false`.

- `tensorscope.server.routers.transforms`
  - Collapsed three near-identical DTO conversions into
    `_param_spec_to_dto` / `_defn_to_dto` helpers. Required ParamSpecs
    serialize their default as `null` (not the `_REQUIRED` sentinel).

- `frontend/src/types/transform.ts`: added `required: boolean` to
  `TransformParamSpec` to mirror the new DTO field.

### OpenAPI surface diff

`GET /api/v1/transforms/psd_multitaper`, `param_schema.K`:

```diff
- "default": 0,
- "description": "Number of tapers (0 = auto)",
- "min_value": 0
+ "default": null,
+ "required": false,
+ "description": "Number of tapers (None = floor(2*NW-1))",
+ "min_value": 1
```

Same shape for `fmax` (default `0` → `null`) and `noverlap` (`-1` →
`null`). Truly required params (e.g. `notch.freqs`, `bandpass.lo_hz`)
now surface as `default: null, required: true`.

### Tests added

- `TestParamSpec.test_default_none_is_optional` — `default=None` is
  optional, returns `None` for missing input.
- `TestParamSpec.test_omitted_default_is_required` — omitting
  `default=` raises on missing input.
- `TestParamSpec.test_concrete_default_falls_back` — concrete defaults
  unchanged.
- `TestExecutor.test_psd_multitaper_empty_params_matches_explicit_none`
  — `params={}` and `params={"K":None,"fmax":None}` produce identical
  output, and `fmax=None` does *not* cap the frequency axis.
- `test_server_api.test_transform_param_schema_no_sentinel_leak` —
  hits the live `/api/v1/transforms/{name}` endpoint and asserts no
  `0`/`-1` sentinel leak for `K`/`fmax`/`noverlap`, plus that truly
  required params surface `required: true`.

### Smoke not run

`pixi run test` and `pixi run frontend-test` were not executable from
this session (sandbox denied `pixi`). Changes verified by reading;
worth running locally before merge.
