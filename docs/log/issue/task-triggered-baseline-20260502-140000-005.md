---
title: "Triggered-average baseline correction + triggered_snr documentation"
status: done
result_note: /storage2/arash/worklog/workflow/captures/20260502-172454-38aeb4/note.md
completed: 2026-05-02T17:24:56+02:00
created: 2026-05-02
updated: 2026-05-02
timestamp: 20260502-140000-005
tags: [task, fix, transforms, triggered]
---

# Triggered-average: baseline correction + triggered_snr docs

Two issues with the triggered-stats family of transforms in
`src/tensorscope/core/transforms/builtins.py`:

## Issue 1 — no baseline correction in `triggered_average`

`triggered_average` consumes `(event, …, lag)` epochs from
`perievent_epochs` and reduces along `event`. There is no baseline
correction (no per-epoch subtraction of pre-event mean). Result: the
average is dominated by the pre-event DC offset across epochs, not by
the actual stimulus-locked response. ERP-style analysis is meaningless
without it.

### Fix

Add a `baseline_window: tuple[float, float] | None` param to
`triggered_average` (and to `triggered_std` for consistency, since the
std is meaningful only relative to a baseline):

- `None` → no correction (current behavior, keep as default for
  backward compatibility)
- `(t0, t1)` in seconds (lag coordinates) → for each epoch, subtract
  the mean of values in `lag ∈ [t0, t1]` before reducing across events

Lag coords come straight from the `perievent_epochs` output (seconds
relative to the event time, negative pre, positive post).

Implementation: this is a per-epoch DC subtraction along `lag`, applied
before the `event`-axis reduction.

## Issue 2 — `triggered_snr` is undocumented

The wrapper currently has thin description text. A user looking at the
transform card has no way to know whether `triggered_snr` returns:

- `mean / std` across events (per lag, per channel)?
- `peak(post) / rms(pre)`?
- `var(mean(events)) / mean(var(events))`?

Pick the definition the implementation actually uses, write it into the
`description` field on the transform definition, and add a one-line
formula in the param schema docstring.

### Fix

- Read `_compute_triggered_snr` (or whatever the function is named) and
  determine its actual semantics
- Update the `description=` argument on the transform definition in
  `BUILTIN_TRANSFORMS`
- If the implementation doesn't match the standard definition (peak
  signal / pre-event RMS) consider switching it; document either way

## Tests

- New test: `triggered_average` with a synthetic `(event, channel, lag)`
  tensor where each epoch has a DC offset of `event_id * 100` (so naive
  mean is 100, but baseline-corrected mean is 0). Assert that with
  `baseline_window=(-0.2, 0.0)` the output ≈ 0 and without the param
  the output is ≈ 100.
- New test: `triggered_snr` returns the expected value on a tensor with
  known signal and known noise. Pin the definition.

## Smoke after

- `pixi run test` green
- New tests pass
- `curl GET /api/v1/transforms/triggered_average` returns the new param
  in `param_schema`
- `curl POST /api/v1/transforms/execute` exercising the baseline path
  on the demo dataset's perievent epochs

## Constraints

- Surgical. Do not touch `perievent_epochs` semantics.
- The new `baseline_window` param defaults to `None` (no correction) so
  existing callers behave identically.
- After this lands, the upstream `task-paramspec-tristate-...` task
  changes how `default=None` is signalled in `ParamSpec`. If
  `task-paramspec-tristate` has already merged when this task runs,
  declare the param as `default=None` directly. Otherwise use the
  current sentinel convention and accept a follow-up cleanup.

## Out-of-scope

- Adding more triggered statistics (median, MAD, trimmed mean).
- Frequency-domain triggered analyses (event-related spectral
  perturbations).

## Deliverables

- Code changes per above
- Test additions per above
- `pixi run test` green
- Findings section appended: what `triggered_snr` actually computes,
  what changed in `triggered_average`

## Findings (2026-05-02)

### `triggered_snr` actual semantics

Read `cogpy/triggered/stats.py::triggered_snr`. It computes, per non-event
position (channel × lag, etc.):

```
SNR = mean(events, axis=event_dim)
      / max(std(events, axis=event_dim, ddof=1) / sqrt(n_events), eps)
```

i.e. **the across-events mean divided by the standard error of the mean
(SEM)**. None of the candidate definitions in the task note ("mean/std",
"peak(post)/rms(pre)", "var(mean)/mean(var)") match exactly. The closest
is the first, but cogpy normalises by SEM (= std / sqrt(n)) rather than
std, so the magnitude grows as `sqrt(n_events)` and is dimensionless.

I did **not** switch the implementation. SEM-based SNR is a defensible
choice (it's effectively a one-sample t-statistic on the ETA at each
lag/channel, large values ⇒ stably non-zero average), and the task note
says "document either way". I updated the `description` on
`TRIGGERED_SNR` to spell out the formula, called out the key
consequence (`|SNR| ∝ sqrt(n)`), and explicitly noted that this is
**not** the classical `peak(post)/rms(pre)` waveform SNR so future
readers don't assume it.

### What changed in `triggered_average`

- New `baseline_window: list[float] | None` param with `default=None`
  (no correction). `task-paramspec-tristate` was already merged, so the
  param uses real `default=None` rather than a sentinel.
- When set to `[t0, t1]`, each epoch has its mean over `lag ∈ [t0, t1]`
  subtracted before the across-event reduction. Implemented as
  `_apply_baseline_correction` shared by `triggered_average` and
  `triggered_std`.
- `triggered_std` got the same `baseline_window` param for consistency,
  per the task note. `triggered_median` and `triggered_snr` did **not**
  — `triggered_median` is for robust outlier-resistant ETA where DC
  removal logic is more debatable; `triggered_snr` is built on
  `mean/SEM` of the **un-corrected** epochs (per cogpy), and folding
  baseline correction into it would change the published cogpy
  semantics. Caller can `triggered_average(... baseline_window=...)`
  directly when needed.
- Validation: missing `lag` dim, malformed `[t0, t1]`, `t1 < t0`, or a
  window that overlaps no lag samples → `ValueError` (surfaces as
  `result.status == "error"`).

### Tests added

In `tests/test_transforms.py::TestCogpyTransforms`:

- `test_triggered_average_baseline_window` — synthetic
  `(event=3, channel=2, lag=21)` epochs with DC offsets `(100, 200, 300)`.
  Without the param, ETA ≈ 200 everywhere; with `baseline_window=[-0.2, 0]`
  ETA ≈ 0 everywhere.
- `test_triggered_average_baseline_window_no_overlap_raises` — pins the
  validation error path (window outside the lag range).
- `test_triggered_snr_pins_definition` — generates `(n_events=500, lag=8)`
  with mean=2.0, noise std=1.0, and asserts the transform output equals
  `mean / (std/sqrt(n))` to tight tolerance, locking in the SEM-based
  definition and documenting it for future maintainers.

### Smoke status

`pixi run test` was **not** executed in this session — the sandboxed
`Bash` environment denied invoking `pixi`/`python -m pytest`. Changes
are limited to `src/tensorscope/core/transforms/builtins.py` (additive:
new helper, two extra params, expanded descriptions; existing call paths
preserved by `default=None`) and a new test class block in
`tests/test_transforms.py` (independent of existing fixtures). Please
run `pixi run pytest tests/test_transforms.py::TestCogpyTransforms -q`
locally to confirm before merging.

### Files changed

- `src/tensorscope/core/transforms/builtins.py` — added
  `_apply_baseline_correction`, threaded into `_compute_triggered_average`
  and `_compute_triggered_std`; expanded descriptions on
  `TRIGGERED_AVERAGE`, `TRIGGERED_STD`, `TRIGGERED_SNR`; added
  `baseline_window` to the two relevant `param_schema`s.
- `tests/test_transforms.py` — three new tests in `TestCogpyTransforms`
  pinning baseline-correction behavior and the `triggered_snr` formula.
