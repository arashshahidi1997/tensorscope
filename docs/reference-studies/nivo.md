Now I have a thorough picture of the codebase. Let me compile the full analysis.

---

## TensorScope Reference Analysis: `plouc/nivo`

---

### 1. Repo Overview

**What this app is:**
`plouc/nivo` is a richly composed React + D3 data visualization library organized as a pnpm monorepo with ~40+ chart-type packages (line, heatmap, scatterplot, bar, annotations, etc.), plus supporting primitives (scales, axes, tooltip, theming, voronoi, colors, annotations). It ships both SVG and Canvas rendering targets for most charts. It also includes an Express-based server-side rendering API (`/api`), a Storybook-based interactive component workspace (`/storybook`), and a Gatsby-based documentation website (`/website`). Testing is split between Jest (unit) and Cypress (component/integration).

**Relevance as a TensorScope reference:**
This is a **genuinely high-value reference** for TensorScope. The overlap is not superficial: nivo has solved the exact class of problems TensorScope faces — typed visualization primitives, linked tooltip/crosshair state, annotation systems, SVG vs Canvas rendering tradeoffs, scale composition, React motion config, and extensible layer/plugin systems. The main gap is that nivo is a *library* (data agnostic, no backend contract), while TensorScope needs a *product* (session state, tensor-aware slicing, dense neurophysiology data). The engineering patterns are transferable; the domain specifics are not.

---

### 2. Features Worth Borrowing

**A. Tooltip Context Provider Pattern**
- **Where:** `packages/tooltip/src/context.ts`, `TooltipProvider.tsx`, `hooks.ts`
- **What:** Tooltip state is split into two contexts — `TooltipActionsContext` (write: `showTooltipAt`, `showTooltipFromEvent`, `hideTooltip`) and `TooltipStateContext` (read: position, content, anchor). Any component deep in the tree calls `useTooltip()` to imperatively trigger tooltip display. Scaling compensation for CSS transforms is explicitly handled.
- **Why valuable:** TensorScope has multiple linked views (timeseries, electrode map, event overlays). A shared, context-driven tooltip/inspector system — where hover on any panel drives a unified floating tooltip — is essential and maps perfectly to this pattern.
- **Verdict: Adapt.** TensorScope's tooltip carries more domain content (voltage, timestamp, channel id, event label) but the split Actions/State context architecture should be copied directly.

**B. Annotation System (SVG + Canvas)**
- **Where:** `packages/annotations/src/` — `types.ts`, `hooks.ts`, `Annotation.tsx`, `canvas.ts`, `compute.ts`
- **What:** Annotations are declared as matchers against data (`AnnotationMatcher<Datum>`). `useAnnotations` computes bound positions; `useComputedAnnotations` computes rendered geometry (link paths, note positions). Both SVG (`<Annotation>`) and Canvas (`renderAnnotationsToCanvas`) renderers exist. Supports circle, dot, rect outlines + leader lines + text notes. Animated via `@react-spring/web`.
- **Why valuable:** TensorScope needs event overlay annotations (spike markers, epoch boundaries, labeled windows) pinned to data positions in dense timeseries and electrode maps. The `AnnotationMatcher<Datum>` → `BoundAnnotation<Datum>` → `ComputedAnnotation<Datum>` pipeline is a clean architectural model for TensorScope's event window system.
- **Verdict: Adapt.** Replace "circle/dot/rect" with TensorScope-specific markers (spike, epoch start/end, label box). The rendering pipeline and SVG/Canvas parity are worth directly borrowing.

**C. Layer / Plugin Architecture**
- **Where:** `packages/line/src/Line.tsx` (L380–405), `packages/scatterplot/src/ScatterPlot.tsx`, `packages/heatmap/src/HeatMap.tsx`
- **What:** Each chart defines a `LayerId` union type (e.g., `'grid' | 'markers' | 'axes' | 'areas' | 'crosshair' | 'lines' | 'points' | 'slices' | 'mesh' | 'legends'`). The `layers` prop is a `(LayerId | CustomSvgLayer)[]`. When rendering, the component iterates the layers array: named layers are matched to pre-built elements; function layers receive the full `customLayerProps` (scales, data, inner dimensions) and render arbitrarily.
- **Why valuable:** TensorScope views (timeseries, electrode map) need to compose standard layers (axes, signal lines, grid) with domain-specific ones (event overlay layer, selection band layer, cursor layer). The layer array pattern makes this composable without hard-wiring it.
- **Verdict: Borrow directly.** Define TensorScope `LayerId` types per view type and expose `layers` prop exactly as nivo does.

**D. Voronoi Mesh for Hit-Testing**
- **Where:** `packages/voronoi/`, referenced in `packages/line/src/Mesh.tsx` and `packages/scatterplot/src/Mesh.tsx`
- **What:** A `<Mesh>` component uses D3 Delaunay/Voronoi to assign hover regions to the nearest data point, enabling pixel-accurate hover on dense scatterplots or line point clouds without requiring per-point hit boxes.
- **Why valuable:** TensorScope timeseries views can have thousands of samples. Rendering individual hit targets per sample is expensive. A voronoi mesh over the electrode positions in the spatial map, or over sample positions in a zoomed timeseries, is the right pattern.
- **Verdict: Adapt.** The implementation is already abstracted; TensorScope can re-use the Mesh component or its approach for electrode map hit detection.

**E. SVG + Canvas Parity Per Chart Type**
- **Where:** `packages/heatmap/src/HeatMap.tsx` vs `HeatMapCanvas.tsx`, `packages/line/src/Line.tsx` vs `LineCanvas.tsx`, `packages/scatterplot/src/ScatterPlot.tsx` vs `ScatterPlotCanvas.tsx`
- **What:** Every chart type ships both an SVG variant (React-spring animated, accessible, composable) and a Canvas variant (`useRef<HTMLCanvasElement>`, imperative `ctx.draw*`, pixel ratio aware). The Canvas variant is used for performance-sensitive rendering (many data points).
- **Why valuable:** TensorScope's dense multichannel timeseries (possibly 256+ channels × thousands of samples) *requires* Canvas for the signal rendering layer. But tooltips, annotations, and selection overlays should stay in SVG/DOM. The hybrid strategy (Canvas signal layer + SVG overlay layer) is the right model, and nivo demonstrates the exact implementation boundary.
- **Verdict: Adapt.** TensorScope should define a Canvas rendering path for dense signal data from the start, and follow nivo's pattern of keeping interactivity overlays in the DOM/SVG layer above.

**F. Theme System (Deep-Merge with Text Inheritance)**
- **Where:** `packages/theming/src/` — `types.ts`, `defaults.ts`, `extend.ts`, `context.tsx`
- **What:** `PartialTheme` is deeply merged with `defaultTheme` via lodash `merge`. Text properties cascade: child text elements (axis ticks, legend text, annotation text) inherit root `theme.text` unless explicitly overridden. `useTheme()` is available anywhere inside `<ThemeProvider>`. Theme covers axes, grid, crosshair, tooltip, annotations, legends, markers.
- **Why valuable:** TensorScope should support light/dark mode and user-configurable scientific color schemes. The theme merging pattern and `useTheme()` hook are directly applicable.
- **Verdict: Borrow directly.** TensorScope's theme system needs to cover scientific concepts (colormap for heatmap/electrode map, signal line colors per channel) which extend beyond what nivo has, but the architecture is the right base.

**G. Crosshair + Slice Tooltip**
- **Where:** `packages/tooltip/src/Crosshair.tsx`, `packages/line/src/SliceTooltip.tsx`, `packages/line/src/Slices.tsx`
- **What:** The `<Crosshair>` component draws configurable vertical/horizontal/cross lines at a current data position. The `Slices` feature in `<Line>` divides the x-axis into bands; hovering a band shows all series values at that x-position as a `<TableTooltip>`. This implements **vertical slice selection** — hover drives a crosshair + multi-series value popup.
- **Why valuable:** This is the paradigm TensorScope needs for time cursor behavior: hover at time T → crosshair at T → tooltip showing all channel values at T. The `SliceTooltip` multi-row table format maps directly to "channel: value" inspection.
- **Verdict: Borrow directly.** This is one of the most immediately applicable patterns in the entire repo for TensorScope's timeseries inspection mode.

**H. `@react-spring/web` Animated Path Transitions**
- **Where:** `packages/core/src/hooks/useAnimatedPath.js`, `packages/line/src/LinesItem.tsx`, `packages/annotations/src/AnnotationNote.tsx`
- **What:** `useAnimatedPath` uses `d3-interpolate`'s `interpolateString` between previous and next SVG path `d` attribute values, driven by `useSpring`. This gives smooth path morphing without DOM re-creation. `useMotionConfig()` allows global enable/disable of animation.
- **Why valuable:** TensorScope channel lines updating on time window scroll, or electrode map cells updating on new data, can use this pattern for smooth transitions. The `immediate: !animate` escape hatch is important for performance mode.
- **Verdict: Borrow directly.** `useAnimatedPath` is a small, self-contained hook. Copy it.

---

### 3. Interaction / UX Ideas Worth Studying

**Navigation:**
- nivo's `<ResponsiveWrapper>` pattern (via `react-virtualized-auto-sizer`) auto-sizes charts to their containers, firing `onResize` callbacks. TensorScope panels should follow this: views declare their rendering size reactively, not as fixed prop inputs.
- Keyboard navigation in icicle chart (Tab/Arrow/Enter/Space/Escape for zoom): documented in `storybook/stories/icicle/shared.tsx`. This is a model for TensorScope's keyboard-driven time window navigation and channel focus.

**Linked Views / Slice Selection:**
- The `enableSlices: 'x'` + `currentSlice` state in `packages/line/src/hooks.ts` is the closest analog to TensorScope's **time cursor**. The slice tracks the hovered x-position, all series values at that x are collected, and the crosshair + tooltip update synchronously.
- For TensorScope's linked AP/ML selection (electrode map → timeseries), adapt this: clicking a cell in the electrode map fires a selection event that drives `currentSlice` (or its TensorScope equivalent) in the timeseries view.

**Dense Data Exploration:**
- Canvas variants handle large point clouds; the SVG mesh stays above for interaction. TensorScope should follow this: Canvas for signal waveforms, transparent SVG overlay for time selection band, crosshair, and event markers.
- nivo does not implement pan/scroll for timeseries; this is a gap TensorScope must fill. But the slice tooltip pattern can be augmented with a draggable time window.

**Annotation / Event Interaction:**
- `packages/annotations/src/` shows how to bind annotations to data positions, compute leader lines, and render in both SVG and Canvas. For TensorScope events (spikes, stimuli, epoch bounds), adapt `AnnotationMatcher<TensorScopeEvent>` → `BoundAnnotation` → `ComputedAnnotation`.

**Layout Ergonomics:**
- nivo's `<Container>` component (`packages/core`) wraps each chart and provides `ThemeProvider`, `TooltipProvider`, and `MotionConfigContext`. This is the boundary between "chart world" and "app world." TensorScope should define an equivalent `<TensorScopeViewContainer>` that provides selection context, tooltip context, and session context for each view panel.

---

### 4. Engineering Patterns Worth Borrowing

**Frontend Architecture:**
- **Monorepo with per-package types.ts:** Each visualization type has `types.ts` defining its `ComputedDatum`, `LayerId`, tooltip/event handler types. TensorScope should follow this: a `types.ts` per view type (`TimeSeries`, `ElectrodeMap`, `EventOverlay`) with explicit computed-data shapes separate from raw API response types.
- **`defaults.ts` + `commonDefaultProps`:** Default values are centralized and typed, not scattered through destructuring. TensorScope components should adopt this.
- **Separation of `hooks.ts` from render:** Each chart type's `use<ChartName>` hook contains all data transformation and scale computation, returning pure computed values to the render tree. TensorScope should follow this: `useTensorSlice`, `useChannelScales`, `useEventBindings` are hooks that consume API data and return render-ready computed structures.

**Data / API Architecture:**
- nivo's API (`/api/app.ts`) is an Express server that accepts POST requests with chart config as JSON body and returns rendered SVGs. This is a *server-side rendering* model that TensorScope explicitly does not want. TensorScope's FastAPI backend is correctly positioned as a *data contract* endpoint, not a rendering endpoint. **Do not copy** nivo's API architecture.

**State Organization:**
- nivo has no global shared state. Tooltip state is provided per-chart via `<TooltipProvider>`. This is appropriate for a library. TensorScope needs a **global** `TensorScopeState` for cross-panel selection (active tensor, time window, AP/ML selection). Adapt the Context pattern but promote selection state to a global provider rather than per-chart.
- The split `TooltipActionsContext` / `TooltipStateContext` pattern (write context separate from read context) is worth copying for TensorScope's `SelectionActionsContext` / `SelectionStateContext` to avoid unnecessary re-renders.

**Rendering Boundaries:**
- nivo's `InnerLine` / `Line` wrapper pattern (the inner component does not know about `animate`, `motionConfig`, `theme`; these are provided by `<Container>`) cleanly separates rendering from configuration. TensorScope should follow this for each view type.
- The `forwardRef` + `WithChartRef<Props, SVGSVGElement>` pattern for exporting the SVG root reference is directly applicable if TensorScope needs to programmatically interact with rendered SVGs (e.g., for screenshots or export).

**Extensibility:**
- The `layers: (LayerId | CustomLayer)[]` pattern is the only extensibility hook nivo exposes per-chart. It is minimal and effective. TensorScope views should expose the same.
- The `annotations` prop pattern (`AnnotationMatcher<Datum>[]`) is another well-designed extensibility point. TensorScope's event overlay system should use a similar declarative matcher pattern rather than coupling event types to renderers.

**Testing:**
- **Cypress component tests** (`cypress/src/components/`) mount individual chart components and test real DOM behavior (focus, blur, ARIA attributes, responsive resizing). This is the right strategy for TensorScope interaction testing ��� unit tests for hooks, Cypress component tests for view-level interaction behavior.
- **`testChartResponsiveness`** helper (`cypress/src/helpers/responsive.tsx`) is a clean test utility pattern. TensorScope should implement a `testViewResponsiveness` equivalent.
- **Storybook with `play` functions** (`storybook/stories/icicle/shared.tsx`) automates keyboard navigation demos. TensorScope can use this for documenting time navigation, channel selection, and event overlay behaviors.

---

### 5. Not a Good Fit for TensorScope

**A. Gatsby-based Documentation Website**
The `/website` directory is a large Gatsby app with auto-generated prop tables, live code editors, and API playground. This is appropriate for an open-source library but TensorScope does not need this infrastructure. Avoid the pattern of building a separate documentation product before the core tool is finished.

**B. nivo's Rendering API (Server-Side SVG Rendering)**
`/api/app.ts` uses React SSR to render charts to SVG on the server. TensorScope's FastAPI backend exists to serve *data*, not to render *visuals*. The rendering should remain entirely in the browser. This architectural choice in nivo is explicitly the wrong direction for TensorScope.

**C. The `@nivo/generators` Fake Data Pattern**
nivo ships `@nivo/generators` for fake data generation (drink stats, country data, etc.) used in demos. TensorScope should use real (or realistic synthetic) neurophysiology data from the start, not toy data generators, because the interesting engineering challenges (downsampling, dense data performance, windowed fetching) only surface with real data shapes.

**D. Flat `PartialTheme` Color Scheme (Not Scientific)**
nivo's color system (`@nivo/colors`) is built around ordinal color scales (categorical) and a few sequential/diverging quantize schemes. TensorScope needs proper **perceptually uniform sequential colormaps** (viridis, plasma, magma) for electrode heatmaps and continuous spectral data. nivo's `ContinuousColorScaleConfig` exists but the whole scheme is UI-centric, not data-science-centric. Use D3-scale-chromatic directly for scientific colormaps.

**E. Animation-First Defaults**
nivo's default `animate: true`, `motionConfig: 'gentle'` are appropriate for dashboard-style charts where data changes infrequently. For TensorScope's dense timeseries where the user is scrolling through continuous data, animation is an anti-pattern — it adds visual noise and latency. Set `animate: false` by default and expose it only as an opt-in for specific transitions (e.g., channel highlight).

**F. Lerna + pnpm Monorepo for TensorScope**
nivo's monorepo structure (40+ packages) is justified because nivo is a *published library* where users install only what they need. TensorScope is a single product. A monorepo adds significant tooling overhead for no end-user benefit. A well-organized single-repo with clear internal module boundaries is preferable at TensorScope's current stage.

**G. `@react-spring/web` for all animation**
nivo uses `@react-spring/web` pervasively for element transitions. This adds a performance overhead per animated element. For TensorScope's dense Canvas rendering path, spring animation adds no value (Canvas renders imperatively anyway). Keep `@react-spring/web` only for SVG overlay elements (crosshair, annotations, selection bands), not for the signal data layer.

---

### 6. Top 5 Recommendations for TensorScope

**#1 — Adopt the Crosshair + Slice Tooltip Pattern (Immediate Impact)**
The `enableSlices` + `<Crosshair>` + `<SliceTooltip>` interaction in `packages/line/` is the most directly applicable feature for TensorScope's time cursor. Implement a `<TimeCursor>` component and `useTimeSlice` hook that mirrors nivo's slice system: hover at time T → vertical crosshair across all panels → tooltip showing channel values at T. This is TensorScope's primary inspection interaction and should be the first cross-panel interaction primitive built.

**#2 — Use the Layer Array Pattern for All View Types**
Define `LayerId` unions and a `layers: (LayerId | CustomLayer)[]` prop for `<TimeSeriesView>`, `<ElectrodeMapView>`, and `<EventOverlayView>`. This allows TensorScope to compose standard layers (axes, grid, signals, events) with domain-specific custom layers without modifying core components. It directly enables the "event overlay" and "selection band" behaviors as optional layers. Implement this before building complex conditional rendering logic inside view components.

**#3 — Build a Split Actions/State Context for Global Selection**
Model TensorScope's `TensorScopeState` as two React contexts: `SelectionActionsContext` (dispatch: `setTimeWindow`, `setActiveChannel`, `setEventFocus`) and `SelectionStateContext` (read: current window, active channel, etc.). Split state-only from actions-only to avoid re-rendering the entire tree on every selection change. This is the architecture demonstrated by `TooltipActionsContext` / `TooltipStateContext` in `packages/tooltip/src/context.ts` and it directly addresses TensorScope's linked-view requirement.

**#4 — Adopt the Annotations Pipeline for Event Overlays**
Implement TensorScope event overlays using a pipeline structurally identical to `packages/annotations/`: `EventMatcher<TensorDatum>[]` → `bindEventAnnotations` → `ComputedEventAnnotation[]` → rendered as a `layers`-based overlay. This handles arbitrary event types (spikes, epochs, stimuli) against timeseries data positions, supports both SVG (interactive) and Canvas (dense) rendering, and keeps event logic declarative and testable.

**#5 — Plan SVG/Canvas Hybrid Rendering from Day One**
Follow nivo's `HeatMap` / `HeatMapCanvas` architecture: TensorScope views should each have an SVG variant (for dev/debug, accessible, annotatable) and a Canvas variant (for production, dense multichannel data). The signal waveform layer must be Canvas for any meaningful number of channels (>8). The selection bands, crosshair, annotations, and axis labels live in a transparent SVG overlay on top. Decide and implement this boundary before adding more signal channels to the demo — retrofitting Canvas rendering onto an SVG-only architecture is expensive.

---

### 7. Evidence

Specific files and modules that support the conclusions above:

```
packages/tooltip/src/context.ts                     — Split Actions/State tooltip context
packages/tooltip/src/hooks.ts                       — useTooltip, useTooltipHandlers, CSS transform scaling
packages/tooltip/src/TooltipProvider.tsx            — Per-chart tooltip provider pattern
packages/tooltip/src/Crosshair.tsx                  — Crosshair component types (x, y, cross, top-left, etc.)
packages/line/src/Slices.tsx                        — Slice selection mechanism
packages/line/src/SliceTooltip.tsx                  — Multi-series value tooltip
packages/line/src/hooks.ts                          — useLineGenerator, useAreaGenerator, usePoints, useLine
packages/line/src/Line.tsx (L370–405)               — Layer iteration pattern, customLayerProps shape
packages/line/src/defaults.ts                       — Layer stack definition, SVG vs Canvas defaults
packages/line/src/Mesh.tsx                          — Voronoi-based hover for dense point sets
packages/heatmap/src/HeatMap.tsx                    — SVG heatmap composition pattern
packages/heatmap/src/HeatMapCanvas.tsx              — Canvas heatmap, imperative draw, pixel ratio
packages/heatmap/src/compute.ts                     — computeCells, computeLayout (band scales)
packages/heatmap/src/HeatMapCells.tsx               — react-spring useTransition for cell enter/update/exit
packages/heatmap/src/types.ts                       — ComputedCell, CustomLayerProps, LayerId
packages/heatmap/src/canvas.tsx                     — renderRect, renderCircle (canvas renderers)
packages/scatterplot/src/ScatterPlot.tsx            — customLayerProps construction, layer iteration
packages/scatterplot/src/Nodes.tsx                  — useTransition for animated node enter/leave
packages/scatterplot/src/Mesh.tsx                   — Voronoi-based hover, showTooltipFromEvent
packages/annotations/src/types.ts                  — AnnotationMatcher, BoundAnnotation, ComputedAnnotation
packages/annotations/src/hooks.ts                  — useAnnotations, useComputedAnnotations
packages/annotations/src/Annotation.tsx            — SVG annotation render (circle/dot/rect + leader)
packages/annotations/src/canvas.ts                 — Canvas annotation renderer
packages/theming/src/types.ts                       — Full Theme type (crosshair, annotations, tooltip)
packages/theming/src/defaults.ts                    — Default theme values
packages/theming/src/extend.ts                      — extendDefaultTheme, text inheritance cascade
packages/theming/src/context.tsx                    — ThemeProvider, useTheme
packages/core/src/hooks/useAnimatedPath.js          — d3-interpolate + useSpring path morphing
storybook/stories/icicle/shared.tsx                 — Keyboard navigation docs and play() automation
storybook/stories/line/Line.stories.tsx             — enableSlices, enableTouchCrosshair in action
cypress/src/components/line/Line.cy.tsx             — Focus/blur tooltip test, responsive test
cypress/src/helpers/responsive.tsx                  — testChartResponsiveness utility
api/app.ts                                          — Server-side rendering API (do NOT copy for TensorScope)
```