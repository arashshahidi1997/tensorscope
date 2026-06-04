# Roadmap — sleep-oscillation coupling tooling

**Status:** implementation roadmap (index + sequencing for the committed specs)
**Created:** 2026-06-04
**Branch:** `refactor/ultracode-batch` (tip `d982cb5`)

The north star: **observe and assess slow-wave ↔ spindle ↔ ripple coupling** on a
multimodal (ecog + neuropixels) session — navigate detected events smoothly, see each
in time/space/frequency, judge their quality, filter to the population of interest, and
view the cortical and hippocampal probes on one shared time axis. This doc sequences the
specs that get there. **Read this first**, then the per-feature spec it points to.

## The committed specs (all implementation-ready, file:line-anchored)

| Spec | Scope | Status |
|---|---|---|
| [`perf-navigation-plan.md`](perf-navigation-plan.md) | LOD/cache/overscan navigation perf (P1–P8) | **DONE + verified** (P4 reverted); merge-ready pending the usual branch call |
| [`oscillation-coupling-plan.md`](oscillation-coupling-plan.md) | Track A profiles · Track B wavelet TF · Track C multi-probe | spec'd, decisions confirmed |
| [`event-filtering-plan.md`](event-filtering-plan.md) | E1–E5 event property-filtering + multi-type display + SO detector | spec'd |

Already-true (verified in code this session, no work needed): multi-type colored event
overlay; brainstate in the navigator (overlay + hypnogram lane); spindle-review is smooth
on narrow event windows (TF ~2 s cold / instant warm via the per-view cache).

## Recommended implementation sequence (value-ordered)

Each step is a separate, test-gated **/ultra-batch**. Ordered by value-per-effort given
the key realization that **ghostipy multitaper is already fast** (so the wavelet is an
optional analysis enhancement, not a prerequisite):

1. **A1 — spectrogram freq-range plumbing** (from `oscillation-coupling-plan.md` Track A).
   *Tiny, highest value-per-effort.* Adds the missing frontend control for spectrogram
   `fmin/fmax/nperseg` → **ripples become viewable in the TF panel with the fast mtm**
   (today it's hardwired 0.5–30 Hz). Unblocks the ripple profile. ~$5–8.
2. **Event filtering — E1 → E3 → E4 → E2** (`event-filtering-plan.md`).
   Property thresholding (histogram-backed), interval-span shading, the **cogpy slow-wave
   detector** (E4 gives SO a one-click source), then the filter UI. Turns event review
   into "isolate the good population." Independent. ~$12–18.
3. **Track C — multi-probe** (`oscillation-coupling-plan.md`). The big coupling unlock:
   ecog + npx on the shared axis (3-row layout confirmed). The transport is already done;
   the load-bearing change is per-panel tensor routing in `useWorkspaceData`. ~$20–30.
4. **Track A2/A3 — viewing profiles** (`oscillation-coupling-plan.md`). One-click
   SO/Spindle/Ripple presets (needs A1; ripple profile benefits from C's npx lane). ~$10.
5. **Track B — wavelet TF** (`oscillation-coupling-plan.md`). *Optional, last.* Joint
   constant-Q resolution across SO→ripple; do it only if the fixed-window mtm resolution
   feels limiting once you're looking at the bands together. CWT is heavier than mtm. ~$10–15.

Dependencies: A1 → A-profiles; C is independent (biggest); E* independent; B independent.
A natural first wave is **A1 + event-filtering** (cheap, unblock + de-clutter), then **C**.

## Confirmed decisions (don't re-litigate)

- Profile values: SO/Delta 0.5–4 Hz/~15 s · Spindle 11–16 Hz/~2.5 s · Ripple 100–250 Hz/~0.6 s (one each; SO-vs-Delta split deferred).
- Multi-probe layout: 3 rows (ecog ts+events / npx depth+ripple-trace / both spectrograms), shared window.
- Wavelet default: Morse (γ=3, β=20), 10 voices/octave.
- Wavelet is a **method field** on `SpectrogramLiveParamsDTO`, not a new view_type.
- Event filtering is **client-side** on the loaded `eventsByStream`, **per-stream**, **data-driven** from each stream's actual columns (properties are detector-heterogeneous).

## Deferred / not yet spec'd

- **P4 process-pool offload** (the forkserver-under-pixi crash) — only matters for *wide*-window heavy spectral compute; narrow event review is fine. Revisit if wide-window TF latency bites.
- **Per-event spectrogram precompute** — alternative to P4; the per-view cache already makes revisits instant, so low priority.
- **Slice-time sync offset** (neuropixels Phase 2) — only for non-zero-offset co-recordings; TTL-aligned sessions are fine without it.
- **Quantitative coupling metrics — the analysis frontier (NEEDS DESIGN, not yet spec'd).**
  Viewing/curating coupling is covered above; *quantifying* it is the logical next track:
  event co-occurrence statistics (spindle↔ripple rates within a lag window — the
  coincidence machinery + filters are the seam), phase-amplitude coupling (ripple power
  to SO phase), and event-triggered averages (the `event_average` view + cogpy
  `triggered_average/std/median/snr` transforms already exist as building blocks). Spec
  this once the viewing/filtering tooling is in hand and the specific metrics are decided.

## How the next session should proceed

1. Read this roadmap + the spec for the chosen step.
2. Confirm `.claude/settings.json` allows `Bash(pixi:*)`/`Bash(git:*)`/`Edit`/`Write` (or a detached `-p` ultra-batch freezes).
3. Launch via **/ultra-batch** with that spec's kickoff prompt (acceptEdits, `--model claude-opus-4-8 --effort xhigh`, a budget cap; ~$11–15 per small batch observed this session).
4. **Independently verify** — don't trust the self-report (this session: P4 passed its unit tests but failed live; Batch B's tile-snap 422 appeared only on a live drive). Run the gates yourself, read the diff, and drive `/verify-ui` + the `/tmp/pwdbg` probes for any render/interaction change.
