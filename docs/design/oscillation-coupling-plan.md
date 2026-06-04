# Oscillation-coupling plan — viewing profiles, wavelet spectrogram, multi-probe

**Status:** ready to execute (specs decided; 3 genuine science/product decisions flagged in Tier-3)
**Created:** 2026-06-04
**Baseline commit:** `e72da64` (perf Batch A+B + 422 fix) on `refactor/ultracode-batch`
**Source surveys:** three code-grounded surface maps (2026-06-04, this session);
[`neuropixels-multiprobe.md`](neuropixels-multiprobe.md) (Track C = its Phase 3),
[`perf-navigation-plan.md`](perf-navigation-plan.md) (same spec format + the per-view cache the wavelet rides).

This doc is the **source of truth** for an ultracode batch that turns TensorScope
into a tool for **observing slow-wave ↔ spindle ↔ ripple coupling**. Read it in
full, plus the *Agent / automation gotchas* in `CLAUDE.md`. Every item names exact
insertion points (file:line) and an acceptance gate.

## Why (the scientific goal + what's measured)

The point of the multimodal audit is to see whether cortical **slow waves** (0.5–4 Hz,
ecog) and **spindles** (11–16 Hz, ecog) couple to hippocampal **ripples**
(100–250 Hz, neuropixels) — the canonical memory-consolidation triad. Three things
block that today, all confirmed in code this session:

1. **No band/view profile.** Switching to "spindle view" vs "ripple view" means
   manually setting a filter band, *and* a spectrogram freq range — except the
   **spectrogram freq range has no frontend control at all** (it's hardwired to the
   server default `fmin 0.5 / fmax 30 Hz`), so **ripples are literally unviewable in
   the TF panel today** (250 Hz ≫ 30 Hz cap).
2. **One fixed-window multitaper can't jointly resolve all three bands** — SO want a
   long window (freq resolution at low freq), ripples a short one (time resolution at
   high freq). A constant-Q wavelet resolves them jointly.
3. **One probe at a time.** Switching the active tensor *resets* the views
   ([appStore.ts:142](../../frontend/src/store/appStore.ts#L142)); ecog and npx can't
   be seen on the shared time axis — yet coupling *is* a cross-structure phenomenon.

Perf context (this session): the spindle-review flow is already smooth on narrow
event windows (timeseries 73 ms, psd 227 ms, **TF spectrogram ~1.6–2.1 s cold / 16 ms
warm via the P1 cache**). **The ghostipy multitaper is already fast** (the original
code note: 22 s dask → ~150 ms; threaded fan-out ~3×) — so Track B is **not** a speed
fix, and CWT is in fact *heavier* than mtm. Two honest clarifications:
- **Ripple *viewability* is a freq-range plumbing problem (Track A's A1), NOT a
  wavelet problem.** The multitaper handles 100–250 Hz fine with a raised `fmax_hz` +
  short `nperseg` — it just has no frontend control today (hardwired 0.5–30 Hz). A1
  alone unblocks ripple TF, with the fast mtm.
- **Track B's real value is JOINT multi-band resolution** (constant-Q): seeing SO
  (0.5–4 Hz), spindle (11–16 Hz), and ripple (100–250 Hz) structure *together* with
  appropriate time/freq resolution at each band, which a single fixed-window mtm can't.
  It's an analysis enhancement for coupling, not a bottleneck fix.

---

## Operating constraints (gamma2 is shared; tokens cost real money)

- **Branch:** stay on `refactor/ultracode-batch` (at `e72da64`). No merge, no push.
- **Token budget:** honor the `+<N>` at launch; stop when reached.
- **Concurrency ≤ 10**; serialize the verify step per item.
- **No worktree isolation for frontend work** (gitignored `frontend/node_modules`).
- **Run ALL JS tooling via `pixi run`** (bare node is v12).
- **Commit per item, EXPLICIT paths only — never `git add -A`.**
- **Do NOT modify in-flight WIP:** `pixi.lock`, `pyproject.toml`, `scratch/`,
  `baseline.png`, `docs/log/**`, `docs/research/{adversarial-critique,build-vs-buy-survey}.md`,
  `docs/design/{channel-viewport,contract-v2,detector-overlay,event-review,pipeline-spec}.md`,
  `.claude/worktrees/**`, the propagation-playback files.
- **Permission allowlist** must cover `Bash(pixi:*)`/`Bash(git:*)`/`Edit`/`Write` or a detached `-p` run freezes.

## Verification gates (an item is "done" only when green)

```bash
pixi run test                                           # backend pytest (331 baseline; only if backend changed)
pixi run frontend-test                                  # vitest (393 baseline)
pixi run bash -c "cd frontend && npx tsc -b"            # typecheck, exit 0
```
**No live/visual auto-verification** (launcher SIGTERM'd; jsdom can't render canvas).
Every render/interaction item is **HUMAN-VALIDATE**: make the code + pure-logic tests,
and flag in the final report what a human must confirm via `/verify-ui` + the
`/tmp/pwdbg` probes (e.g. ripple TF actually paints up to 250 Hz; both probes draw on
the shared axis). Measurement harness for the wavelet cost: `/tmp/pwdbg/spec-clean.mjs`.

---

## Track B — Wavelet / multi-resolution spectrogram (joint multi-band resolution)

> Note: the multitaper is already fast; this track is the **joint-resolution analysis
> feature** (constant-Q across SO→ripple), not a speed fix and not what unblocks ripple
> viewing (that's A1's freq-range plumbing). CWT is heavier than mtm — see the cost note.

A `method` field on the spectrogram params DTO, NOT a new view_type — it rides the
existing view registry, query builder, v2 extractor, canvas view, and P1 cache
unchanged (output shape is identical `(time, freq, *spatial)`).

### B1 · Add the wavelet params (backend + frontend DTO)
- **Goal:** carry the method + wavelet knobs on the wire.
- **Scope:** `src/tensorscope/server/models.py` `SpectrogramLiveParamsDTO` (L235): add
  `method: Literal["multitaper","wavelet"] = "multitaper"`, `wavelet: Literal["morse","amor","bump"] = "morse"`,
  `voices_per_octave: int = Field(default=10, ge=1, le=48)`; relax `_check_freq_range`
  (L282) so the mtm-only `nperseg`/`bandwidth` are simply ignored when `method=="wavelet"`.
  Mirror the optional fields on `frontend/src/api/types.ts` `SpectrogramLiveParamsDTO` (L76).
- **Acceptance:** backend test — the DTO accepts a wavelet payload and round-trips;
  multitaper default unchanged. `tsc -b` green.
- **Tag:** AUTOMATE.

### B2 · Backend CWT compute branch
- **Goal:** compute a constant-Q wavelet spectrogram with the same output contract.
- **Scope:** `src/tensorscope/server/state.py` spectrogram_live branch (L1071). Branch on
  `spec_params.method`: keep the mtm path; add a `cwt` path that **reuses** the reshape
  to `(n_ch, T)` (L1131–1146), the per-channel `ThreadPoolExecutor` fan-out (L1157–1182,
  pinning `gsp.cwt(..., n_workers=1)`), the median-per-freq normalization (L1200–1219),
  and the output `xr.DataArray` assembly (L1221–1253). Per channel:
  `coefs, scales, freqs, times, cois = gsp.cwt(x, fs=fs, freq_limits=[fmin_hz, fmax_hz], voices_per_octave=…, wavelet=<MorseWavelet|AmorWavelet|BumpWavelet>, remove_mean=True, method="ola")`,
  power = `abs(coefs)**2`. **Two CWT-specific musts:** (a) ghostipy returns freqs
  **descending** (scale-ordered) → sort ascending + reorder coef rows before the freq-clip;
  (b) CWT has one column per input sample (no hop) → **decimate the time axis to honor
  `max_time_segments`** (mandatory — a 60 s × 1.25 kHz window is ~75k columns). Stamp
  `spectrogram_live_method="wavelet"` in attrs.
- **Acceptance:** backend test on a synthetic multi-tone signal (e.g. 1 Hz + 12 Hz + 150 Hz):
  the wavelet spectrogram has power peaks at all three freqs (proving joint resolution
  the mtm path at fmax 30 can't show 150 Hz), returns `(time,freq,*spatial)` with
  ascending freqs and ≤ `max_time_segments` time columns. `pixi run test` green.
- **Tag:** AUTOMATE-CODE + HUMAN-VALIDATE (visual: ripple-band TF paints). Depends on B1.

### B3 · Frontend: thread the method through + a toggle
- **Goal:** let the user pick multitaper vs wavelet; default multitaper (unchanged).
- **Scope:** thread a params object into the (currently param-less) call
  `makeSpectrogramLiveRequest(selectionDraft, expensiveSafeWindow)` at
  `frontend/src/components/views/useWorkspaceData.ts:181` (the `params` slot already
  exists at `queries.ts:755`); source the method from a new `appStore` field (mirror
  `freqLogScale`); add a small method selector to the `SpectrogramView` toolbar
  (`SpectrogramView.tsx:178`, beside the existing `log` button). The P1 cache key already
  includes the params dump — wavelet results cache automatically (no cache change).
- **Acceptance:** vitest — the spectrogram request carries `method` when set; default
  omits it (multitaper). Full suite + tsc green.
- **Tag:** AUTOMATE-CODE + HUMAN-VALIDATE. Depends on B2.

**Cost note:** CWT is heavier than mtm per channel. Mitigations already in the pattern:
the per-channel threadpool, `method="ola"`, a conservative `max_time_segments`, and the
`expensiveSafeWindow` debounce (P5). No new offload machinery for the MVP — but wide-window
wavelet will be slower than mtm; the per-event cache + narrow review windows keep it usable.

---

## Track A — Oscillation viewing profiles (SO/Delta · Spindle · Ripple)

A one-click profile that coherently sets the trace band + spectrogram band/window +
PSD range + time window + the matching detector/event overlay. Mirrors the
`LayoutPresetPicker` pattern.

### A1 · Plumb spectrogram params to the frontend (the missing control)
- **Goal:** the spectrogram freq range/window must be settable at all (today it's
  server-default-only → ripples unviewable).
- **Scope:** add `specFmin`/`specFmax`/`specNpersegS` to `frontend/src/store/appStore.ts`
  (+ setters; defaults matching the DTO: 0.5/30/1.0); thread them into
  `makeSpectrogramLiveRequest(...)` at `useWorkspaceData.ts:181` via its existing `params`
  slot. (Pairs with B3 — same call site.) Optionally add a Spectrogram settings group to
  the sidebar (mirror the PSD Settings group in `ExploreTabContent.tsx:137`).
- **Acceptance:** vitest — setting `specFmax=250` makes the spectrogram request carry
  `fmax_hz:250`; default unchanged. Full suite + tsc green.
- **Tag:** AUTOMATE. Foundational for A2's ripple profile.

### A2 · Profile registry + picker + orchestrator
- **Goal:** `OSC_PROFILES` + a topbar picker + an `applyOscillationProfile` action.
- **Scope:** new `frontend/src/components/layout/oscillationProfiles.ts` —
  `OSC_PROFILES: { id, label, band:[lo,hi], specFmin, specFmax, specNpersegS, specMethod, psdFmax, psdNW, windowS, detector }[]` (values in Tier-3 D-PROFILE).
  New `frontend/src/components/layout/OscillationProfilePicker.tsx` (mirror
  `LayoutPresetPicker.tsx`), mounted in `LayoutShell.tsx:121` `topbar-actions`. An
  `applyOscillationProfile(profile)` orchestrator (appStore action or a hook) fans out:
  `setBandPreset("custom")`+`setBandCustom(band)` (or extend `BAND_PRESETS`),
  the new `specF*`/`specMethod` setters, `setPsdFmax/setPsdNW`, and
  `useSelectionStore.setDuration(windowS)`.
- **Acceptance:** vitest — `applyOscillationProfile(SPINDLE)` leaves the stores in the
  expected state (band [11,16], specFmax 20, window 2.5 s, etc.). Full suite + tsc green.
- **Tag:** AUTOMATE-CODE + HUMAN-VALIDATE (the profile visibly re-tunes all panels).
  Depends on A1 (+ B for the ripple profile's wavelet method).

### A3 · Wire the event-overlay leg (best-effort)
- **Goal:** a profile also surfaces the matching detector's events.
- **Scope:** if a stream matching the profile's detector is already pinned/exists
  (`useEventStreamsStore`), `setActiveStream`/`pinStream` it; otherwise pre-fill the
  DetectorSection (`PipelineTabContent.tsx:404`) with the profile's detector + band params
  (a profile can't conjure events — flag this clearly in the picker: "run detector to
  overlay"). Do NOT auto-run detectors.
- **Acceptance:** vitest — the orchestrator pins an existing matching stream; no-ops
  gracefully when absent. Full suite + tsc green.
- **Tag:** AUTOMATE. Depends on A2.

---

## Track C — Multi-probe composability (ecog + npx on the shared axis)

The transport, slice API, events, worker pool, and per-tensor caching are **already
tensor-name-parameterized and done**. The work is narrow: route per-panel tensors and
add a multi-probe layout. This is `neuropixels-multiprobe.md` Phase 3.

### C1 · Per-panel tensor routing in the data layer (the load-bearing change)
- **Goal:** `useWorkspaceData` must fetch a panel's views against the panel's tensor, not
  the single global `selectedTensor`. (React Query keys already include the tensor name —
  two tensors fetch + cache independently with zero collision; only the call sites bind.)
- **Scope:** `frontend/src/components/views/useWorkspaceData.ts` — its ~12 query call sites
  (timeseries L103, spatial L112, depth_map L118, raster L124, psd_average L139,
  spectrogram L144, psd_live L160, spectrogram_live L178, navigator L185, bandpass L203)
  all pass `selectedTensor`. Thread a per-view tensor resolver (a `tensorByView` map from
  `panelTensorOverrides ?? selectedTensor`) OR instantiate the hook per lane (a fixed,
  legal hook count). `clampWindow`/`makeNavigatorRequest` need the *resolved* tensor's
  `timeCoord` for bounds — fetch the second tensor's meta too.
- **Acceptance:** vitest — with an override `{timeseries:"neuropixels"}`, the timeseries
  query is keyed on `"neuropixels"`, others on the global tensor. Full suite + tsc green.
- **Tag:** AUTOMATE-CODE + HUMAN-VALIDATE. The crux; do first in Track C.

### C2 · Build viewElements per resolved tensor + de-collide slot IDs
- **Goal:** the rendered panel children must come from the panel's tensor's data; allow
  the same view (e.g. two `timeseries` lanes) twice.
- **Scope:** `WorkspaceMain.tsx:437–696` builds `viewElements` from one tensor — build
  per-lane from per-lane data (C1's outputs). `panelTensorOverrides`/the slot map are keyed
  by `viewId` (`ViewGrid.tsx:66`) which collides for duplicated views — give the multi-probe
  slots distinct slot IDs (e.g. `timeseries_npx`) and key overrides by slot ID.
- **Acceptance:** vitest/render-logic test — two timeseries slots resolve to distinct
  tensors. Full suite + tsc green.
- **Tag:** AUTOMATE-CODE + HUMAN-VALIDATE. Depends on C1.

### C3 · A multi-probe slot layout
- **Goal:** a default "probe lanes" layout stacking ecog + npx views on the shared axis.
- **Scope:** add a `PROBE_LANES_LAYOUT: ViewSlotLayout` to
  `frontend/src/components/views/viewGridLayout.ts` (contents = Tier-3 D-LAYOUT), and
  parameterize `ViewGrid.tsx:50` (today hardcoded `const layout = DEFAULT_SLOT_LAYOUT`) to
  pick it from a new store field; ship a default `panelTensorOverrides` for that layout
  (`{ timeseries_npx:"neuropixels", depth_map:"neuropixels", spectrogram_npx:"neuropixels" }`).
  Do NOT extend the orphaned `LAYOUT_PRESETS`/`ViewGridLayout` machinery (dead — `ViewGrid`
  never reads `layoutStore.viewGridLayout`).
- **Acceptance:** vitest — selecting the probe-lanes layout yields the expected slot/tensor
  assignment. Full suite + tsc green.
- **Tag:** AUTOMATE-CODE + HUMAN-VALIDATE. Depends on C2.

### C4 · Pass the resolved tensor to the 4 spatial views' mask reads
- **Goal:** `DepthMapSliceView` / `SpatialMapSliceView` / `PSDSpatialView` / `PropagationView`
  read `selectedTensor` from the global store only for their channel-mask lookup
  (`DepthMapSliceView.tsx:25`, `SpatialMapSliceView.tsx:40`, `PSDSpatialView.tsx:24`,
  `PropagationView.tsx:41`) — wrong tensor's mask in multi-probe.
- **Scope:** pass the panel's resolved tensor name as a prop and use it for the mask lookup.
- **Acceptance:** vitest — the mask lookup uses the prop tensor. Full suite + tsc green.
- **Tag:** AUTOMATE. Depends on C1.

### C5 · A multi-probe mode that doesn't reset on tensor switch
- **Goal:** entering multi-probe must not wipe the per-lane tensor map.
- **Scope:** `appStore.ts:142` `setSelectedTensor` clears `panelTensorOverrides` + `activeViews`.
  Add a `multiProbeMode` flag; when set, `selectedTensor` is just the navigation default and
  the per-slot tensor map (+ the fixed probe-lanes layout) is the source of truth — don't
  blanket-clear the overrides. Keep `focusChannel` per-lane (intentionally not shared).
- **Acceptance:** vitest — in multi-probe mode, changing the nav-default tensor preserves the
  overrides. Full suite + tsc green.
- **Tag:** AUTOMATE-CODE + HUMAN-VALIDATE. Depends on C3.

### C6 · (DEFER) Slice-time sync offset — only for non-zero offsets
- TTL-aligned co-recordings have offset 0 (the nwb audit case), so simultaneous display
  works WITHOUT this. `prepare_linear_probe`'s `time_offset_s` is stamped-but-unconsumed at
  slice time (`neuropixels-multiprobe.md` Phase 2). **Out of scope** unless a session has a
  residual offset — listed so the swarm doesn't attempt it.

---

## Tier 3 — decisions (CONFIRMED 2026-06-04; the swarm uses these as decided values)

- **D-PROFILE · the profile values.** ✅ DECIDED (use as-is): single profile each —
  SO/Delta = band 0.5–4 Hz, spec 0.3–6 Hz, window ~15 s, wavelet, detector `cogpy_threshold`(banded);
  Spindle = 11–16 Hz, spec 8–20 Hz, window ~2.5 s, multitaper-ok, detector `cogpy_spindle`;
  Ripple = 100–250 Hz, spec 80–300 Hz, window ~0.6 s, **wavelet**, detector `cogpy_ripple`.
  (SO-vs-Delta split deferred — one SO/Delta profile for now.)
- **D-LAYOUT · what the multi-probe layout shows.** ✅ DECIDED (3-row): row 1 ecog timeseries
  (spindle band) + spindle/SO event lanes; row 2 npx depth_map + npx ripple-band timeseries;
  row 3 ecog spectrogram + npx spectrogram, both on the shared window.
- **D-WAVELET · default wavelet + voices.** ✅ DECIDED: Morse (ghostipy default γ=3, β=20),
  `voices_per_octave=10`. Superlet is a future option (not in ghostipy directly); Morse CWT is the first cut.
- **D-MULTIPROBE-MODE · UX of entering multi-probe.** ✅ DECIDED: a "Probe lanes" entry in the
  layout picker that also flips `multiProbeMode` (informs C5).

---

## Phasing & dependencies

```
Track B (wavelet):   B1 → B2 → B3        (backend-first; enables ripple TF; lowest risk)
Track A (profiles):  A1 → A2 → A3        (A1 foundational; ripple profile needs B)
Track C (multiprobe):C1 → C2 → C3 → C5,  C4 ∥ C1      (C1 is the crux; C6 deferred)
```
Recommended order: **B then A then C.** B is small + unblocks band-correct TF; A is the
convenience layer (needs B for ripples); C is the biggest and benefits from both. Run as
**three separate ultra-batches** (one per track) so each is reviewed before the next.

## Kickoff prompts (one per track; via /ultra-batch)

**Track B — wavelet spectrogram:**
```
/effort ultracode
Read docs/design/oscillation-coupling-plan.md IN FULL (source of truth) + the
Agent/automation gotchas in CLAUDE.md. Branch refactor/ultracode-batch at e72da64 —
stay on it, no branch/merge/push. Execute ONLY Track B: B1 → B2 → B3. Do NOT touch
Tier-3 (D-*) or Tracks A/C. Token budget: +700000. pixi for all JS tooling; commit per
item EXPLICIT paths only (never git add -A); verify each item green (backend `pixi run
test` for B1/B2, frontend-test + tsc for B3) before the next; HUMAN-VALIDATE items get
code + pure tests + a flag (ripple-band TF must paint to 250 Hz — human/verify-ui).
Final per-item report.
```
**Track A — viewing profiles** (after B; uses D-PROFILE values once confirmed):
```
… Execute ONLY Track A: A1 → A2 → A3. Token budget: +700000. Same constraints.
Use the D-PROFILE values from the doc's Tier-3 (confirmed). Front-end gates
(frontend-test + tsc) per item. Final per-item report.
```
**Track C — multi-probe** (the big one; after the D-LAYOUT decision):
```
… Execute ONLY Track C: C1 → C2 → C3 → C4 → C5 (C6 is DEFERRED — do not attempt).
Token budget: +1500000. No worktree isolation (frontend). Use the D-LAYOUT view set
from Tier-3 (confirmed). frontend-test + tsc per item. HUMAN-VALIDATE: both probes draw
on the shared time axis, time-aligned. Final per-item report.
```

Confirm the `.claude/settings.json` allowlist covers `Bash(pixi:*)`/`Bash(git:*)`/`Edit`/`Write`
before any detached `-p` launch, or it freezes.
