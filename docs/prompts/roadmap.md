# TensorScope — Agentic Implementation Roadmap

Role: human-oriented planning document.

Use this file for:

- product direction
- phase ordering
- milestone planning
- larger implementation sequences

Do not use this file as the source of truth for current implementation state.
For current state and guardrails, use:

- [architecture](../architecture/tensorscope.md)
- [context snapshot](./context_snapshot.md)
- [prompt usage guide](./README.md)

For single agent runs, prefer the scoped prompts in [`docs/prompts/tensorscope/`](./tensorscope/00_context.md).

## 1. Product vision

TensorScope is not a plotting app. It is a **tensor-centric scientific visualization environment** for large neurophysiology data.

Core design principles:

* **Tensor-first**: views are derived from typed tensors, not ad hoc plotting calls.
* **Shared selection state**: time, channel, frequency, event, trial, spatial region.
* **Linked views**: interactions in one view update all others.
* **Multiscale navigation**: the UI must support fluid movement from long recordings to short events.
* **Renderer abstraction**: CPU-first baseline, GPU-accelerated where it materially helps.
* **Agent-friendly architecture**: codebase and docs must be decomposable into phases that AI coding agents can implement safely.

## 2. Strategic goals

### Near-term goal

Build a React/TypeScript foundation that reproduces and exceeds the useful interaction model of Bokeh/Panel for large timeseries and linked neurophysiology views.

### Medium-term goal

Turn TensorScope into a reusable framework for tensor navigation, linked scientific views, and event-centric exploration.

### Long-term goal

Enable semi-automatic and AI-assisted scientific exploration over large tensor datasets.

## 3. Highest-value visualization pillars

### Pillar A — Multiscale Time Navigation

The user can move fluidly across orders of magnitude in time.

Representative views:

* overview timeline
* detail trace viewer
* spectrogram/detail pane
* event markers and intervals

Why first:

* this is foundational for every workflow
* it forces good data loading and state architecture
* it gives immediate user value even before advanced spatial features exist

### Pillar B — Linked Tensor Exploration

All views subscribe to a shared `SelectionState`.

Representative interactions:

* click event -> all views center on event
* brush time range -> all linked detail views update
* select channel/grid position -> trace, spec, feature panes update
* choose frequency band -> heatmap and statistics update

Why first:

* this is the core TensorScope identity
* it converts plots into an exploration environment

### Pillar C — Event / Propagation Explorer

For events such as ripples, dentate spikes, spindles, etc., show spatiotemporal structure rather than only traces.

Representative views:

* event-aligned trace stack
* event spectrogram
* electrode-grid propagation map
* phase / power / latency overlays

Why later but still central:

* high scientific payoff
* depends on stable time navigation and shared state
* benefits from GPU acceleration but should have CPU fallback

## 4. Architecture decisions already implied

### 4.1 Core domain model

TensorScope should revolve around three registries/stores:

1. **Tensor registry**

   * named tensors
   * metadata
   * dimensions
   * coordinate schemas
   * lineage / provenance

2. **View registry**

   * which view types can render which tensor schemas
   * default parameterization
   * renderer backend

3. **Selection state**

   * time range
   * time cursor
   * selected channels
   * selected frequency range/band
   * selected events
   * selected trials
   * selected spatial region

### 4.2 Rendering philosophy

* **CPU-first baseline**
* **GPU optional acceleration**
* use the simplest renderer that meets the need

Suggested mapping:

* timeseries: `uPlot`
* overview/minimap timelines: `uPlot`
* grid heatmaps / propagation maps: Canvas first, later WebGL (`regl` or similar)
* large point clouds / state-space: WebGL later

### 4.3 Data philosophy

The true bottleneck is not raw rendering but data movement.

Must support:

* chunked loading
* level-of-detail / multiresolution pyramids
* lazy derivation
* explicit coordinate transforms

### 4.4 Agentic development philosophy

The system must be decomposed into phases with:

* crisp interfaces
* explicit acceptance criteria
* small implementation surfaces
* docs-first specs
* testable invariants

## 5. Proposed phased roadmap

## Phase 0 — Specification and scaffolding

### Goal

Freeze the conceptual model strongly enough that agents can implement components without architectural drift.

### Deliverables

* architecture spec
* terminology/glossary
* tensor schema definitions
* selection state spec
* view registry spec
* renderer policy note
* implementation phase plan

### Key files

* `docs/.../tensorscope-spec.md`
* `docs/.../tensorscope-plan.md`
* `docs/.../tensorscope-context/`

### Exit criteria

* vocabulary is stable
* dimensions are named consistently
* phase boundaries are clear

---

## Phase 1 — Core state architecture

### Goal

Implement the central state model.

### Scope

* `SelectionState`
* tensor registry skeleton
* view registry skeleton
* typed actions/selectors
* serialization/deserialization of view state

### Technology

* React + TypeScript
* Zustand for state
* Zod or equivalent for runtime validation

### Deliverables

* store modules
* types for dimensions and coordinates
* state mutation API
* tests for linking semantics

### Example acceptance tests

* setting `timeRange` updates subscribers only where relevant
* selecting an event updates derived time cursor/window
* selecting a channel updates all channel-aware views

### Why first

Without this, every later visualization becomes ad hoc.

---

## Phase 2 — Timeseries foundation

### Goal

Build the high-performance baseline viewer that replaces the Bokeh feel.

### Scope

* `TimeseriesPlot` using `uPlot`
* Bokeh-like gesture toolbar
* pan / box zoom / wheel zoom / reset
* overview + detail synchronization
* linked cursor and linked range

### Deliverables

* reusable `TimeseriesPlot`
* reusable interaction plugin/tool layer
* overview/detail composition
* tests for gesture correctness

### Acceptance criteria

* smooth navigation over large traces
* no React rerender loop during drag
* scale updates use direct `uPlot` APIs
* reset reliably restores initial extent

### Why now

This is the base interaction substrate for the rest of the app.

---

## Phase 3 — Schema-aware view system

### Goal

Move from isolated components to TensorScope-style view composition.

### Scope

* tensor descriptors
* view descriptors
* compatibility matching (`which view can render which tensor`)
* parameter panels derived from view/tensor metadata
* dynamic layout composition

### Deliverables

* `TensorDescriptor`
* `ViewDescriptor`
* registry lookups
* default view generation for common tensor schemas

### Acceptance criteria

* given a tensor schema, app suggests valid views
* views can subscribe to shared state without custom wiring per component
* sidebar can reflect current view params dynamically

### Why here

This is the step from “chart app” to “tensor explorer”.

---

## Milestone sequence from M4 onward

M1 through M3 remain the current foundation:

* M1 — Architecture Spine
* M2 — Data + Linked Scientific Views
* M3 — Spatial Dynamics

From M4 onward, the roadmap should separate:

* the interactive analysis workspace
* the transform graph that explains derived tensors
* the execution/export layer that turns curated analysis state into reproducible workflows

That separation prevents TensorScope from collapsing exploratory UI state and durable pipeline state into the same model.

Related architecture notes:

* [transform-dag.md](../architecture/transform-dag.md)
* [pipeline-export.md](../architecture/pipeline-export.md)

---

## M4 — Transform Registry And Derived Tensors

### Goal

Introduce explicit transforms and derived tensors as first-class analysis objects.

### Scope

* `TransformRegistry` and transform discovery
* explicit `TransformNode` definitions for analysis steps
* derived tensor creation as registered outputs rather than ad hoc view logic
* provenance and parameter capture for derived tensors
* worker-backed execution and cache boundaries for heavier transforms

### Deliverables

* transform registration contract
* derived tensor model linked to source tensors
* provenance metadata for transform inputs, parameters, and outputs
* reusable compute/caching boundary for transform execution

### Acceptance criteria

* views consume derived tensors instead of computing them inline
* transform parameters are explicit and serializable
* derived tensors retain lineage back to source tensors and transforms
* heavier transform work can run asynchronously without breaking the CPU-first baseline

### Why here

TensorScope needs an explicit analysis model before it can expose transform lineage or export curated workflows.

M4 is intentionally narrower than M5 and M6. It provides the transform and derived-tensor foundation, but it does not yet define the visible workspace graph or the export layer.

---

## M5 — Transform DAG And Workspace Graph

### Goal

Expose the interactive transform graph as a navigable workspace object.

### Scope

* `TensorNode`, `TransformNode`, and `TransformEdge` as graph primitives
* workspace DAG for tensor lineage and transform inspection
* graph inspection UI
* toggling node visibility without deleting provenance
* browsing and viewing intermediate tensors
* parameter inspection for transform nodes

### Deliverables

* transform DAG model integrated with `TensorRegistry` and `TransformRegistry`
* provenance graph queries for upstream/downstream lineage
* workspace graph panel or inspector contract
* visibility and pinning rules for exploratory intermediate nodes

### Acceptance criteria

* users can inspect transform lineage from any derived tensor
* intermediate tensors can be surfaced and inspected without special-case wiring
* graph navigation does not replace shared navigation state for cross-view coordination
* temporary exploratory nodes remain distinct from curated exportable nodes

### Why here

The transform DAG is part of the analysis model. It should exist before any execution export layer is defined.

M5 is separate from M4 because graph inspection, lineage traversal, and workspace-node state are not the same as transform registration. It is also separate from M6 because workspace exploration should not be forced into execution semantics.

---

## M6 — Pipeline Export And Workflow Cooking

### Goal

Export curated transform state into a reproducible execution specification.

### Scope

* pipeline state document in YAML or JSON
* transform graph serialization
* promotion rules from workspace DAG nodes to pipeline DAG nodes
* execution metadata and output declarations
* workflow cooking for systems such as Snakemake

### Deliverables

* pipeline state schema
* serializer from curated workspace graph to pipeline document
* node-promotion model for separating exploratory and execution-ready transforms
* Snakemake-oriented workflow generation contract

### Acceptance criteria

* curated source tensors, transforms, parameters, and outputs can be exported deterministically
* exported pipeline state preserves provenance needed for reproducibility
* workflow cooking operates on promoted nodes rather than the entire exploratory workspace
* interactive workspace behavior remains usable without pipeline export

### Why here

Pipeline export is an execution-layer milestone. It depends on explicit transforms and a visible DAG, but it does not replace the interactive workspace.

M6 is separate from M5 because export requires a curated pipeline DAG, a pipeline state file, and execution metadata that should not be mixed into ordinary workspace inspection.

---

## M7 — Dynamic Workspace Layout

### Goal

Upgrade the fixed three-column shell into a flexible, user-configurable workspace layout.

### Scope

* resizable column dividers between sidebar, center workspace, and inspector
* collapsible sidebar and inspector panels
* tabbed left sidebar (Explore, Graph, Tensors, Events, Pipeline) reflecting the feature surfaces from M4–M6
* flexible center workspace view grid (1x1, 1x2, 2x1, or 2x2 arrangements)
* view panel chrome with maximize and close affordances
* optional bottom panel for persistent overview surfaces (navigator, events)
* layout state persistence via localStorage
* task-oriented layout presets (Signal Inspection, Spatial Exploration, Spectral Analysis)
* keyboard shortcuts for panel toggling and view focus

### Deliverables

* resizable LayoutShell with drag handles and collapse toggles
* tabbed sidebar with tab bar, tab content routing, and per-tab content contracts
* ViewGrid component with configurable rows/columns and ViewPanel chrome
* bottom panel region for navigator and future persistent surfaces
* layout state model, localStorage persistence, and preset system
* keyboard shortcut handler for workspace navigation

### Acceptance criteria

* shell columns are resizable via drag handles
* sidebar and inspector can be collapsed and expanded
* left sidebar has tabbed navigation with at least Explore and Events tabs implemented
* center workspace supports at least a 2-column view arrangement
* each view has a panel header with maximize and close affordances
* layout state persists across page reloads
* at least three task-oriented presets are defined and selectable
* keyboard shortcuts for sidebar toggle and view maximize are functional

### Why here

M7 depends on M4–M6 having populated the sidebar tabs with real content (tensor browser, DAG inspector, pipeline export). The fixed shell from M1 was appropriate for early milestones but becomes a bottleneck as the workspace grows.

M7 is a UI-structure milestone. It does not change data flow, tensor slicing, or transform execution. It restructures how existing views and controls are arranged in the shell.

Related prompt pack: [tensorscope-m7](./tensorscope-m7/README.md)

---

## MA1 — Optional GPU Rendering Acceleration

### Goal

Provide optional rendering acceleration for spatially dense or animated views.

### Scope

* WebGL-backed renderer paths
* large-channel spatial rendering
* accelerated propagation visualization
* renderer selection behind the existing CPU-first contract

Related prompt pack: [tensorscope-ma1](./tensorscope-ma1/README.md)

### Why optional

TensorScope must remain usable and architecturally coherent on the CPU path established in M1 through M3.

---

## MA2 — Optional Queryable Workspace And Assistant Hooks

### Goal

Expose the workspace state for structured querying, command-driven navigation, and external agent integration.

### Scope

* command palette and structured workspace queries
* queryable graph and tensor metadata
* context export for external assistants or coding agents
* machine-readable snapshots of the current workspace and curated graph state

Related prompt pack: [tensorscope-ma2](./tensorscope-ma2/README.md)

### Why optional

These capabilities extend discoverability and automation, but they are not required for the core interactive analysis and pipeline-export architecture.

## 6. Recommended implementation sequence for agents

For actual agent execution, each phase should be broken into **small vertical slices**.

Recommended first 8 agent tasks:

1. Define core TypeScript types for dimensions, coordinates, tensor metadata, and selection state.
2. Implement Zustand `SelectionState` store with tests.
3. Implement `TimeseriesPlot` wrapper around `uPlot` with fixed lifecycle and refs.
4. Add gesture toolbar plugin: pan, box zoom, wheel zoom, reset.
5. Build overview + detail linked timeseries demo.
6. Implement minimal tensor registry and view registry.
7. Create linked signal + spectrogram + event track workspace demo.
8. Add multiresolution data source abstraction and benchmark on realistic traces.

## 7. Suggested repo structure

```text
src/
  core/
    state/
    tensor/
    view/
    data/
    interaction/
    render/
  components/
    timeseries/
    spectrogram/
    event-track/
    channel-grid/
  features/
    workspace/
    event-browser/
  workers/
  schemas/
  utils/

docs/
  explanation/
  reference/
  tutorials/
  adr/
```

## 8. ADRs worth writing early

Write short architecture decision records for:

1. Why React + TypeScript + Zustand
2. Why `uPlot` for timeseries
3. CPU-first with optional GPU acceleration
4. Why tensor registry + view registry + selection state
5. Why multiresolution data sources are mandatory

## 9. Risks and mitigation

### Risk 1 — Drifting back to plot-centric design

Mitigation:

* enforce tensor/view registry concepts early
* keep shared state central

### Risk 2 — Re-render and performance regressions

Mitigation:

* isolate hot rendering paths from React
* benchmark each interaction primitive

### Risk 3 — Data loading complexity arrives too late

Mitigation:

* introduce chunk/LOD abstractions before many advanced views

### Risk 4 — GPU complexity takes over too early

Mitigation:

* CPU baseline first
* only introduce WebGL where profiling proves need

### Risk 5 — Agent outputs become inconsistent

Mitigation:

* use docs-first specs
* create phase-specific prompts
* maintain snapshot/context docs

## 10. Definition of success for v1

A strong first public/internal TensorScope milestone would be:

* large timeseries navigation feels excellent
* overview/detail workflow is fluid
* signal, spectrogram, event track, and channel selection are linked
* event selection recenters all views
* architecture is clearly extensible toward propagation and GPU views

## 11. Concrete next milestone recommendation

The best immediate milestone is:

**Milestone M1 — Linked Multiscale Explorer**

Includes only:

* selection state store
* `uPlot` timeseries viewer
* gesture toolbar
* overview/detail sync
* event track
* linked spectrogram
* minimal tensor/view registry stubs

This is small enough to build, but ambitious enough to validate the architecture.

## 12. Next-step agent prompt strategy

For each phase, prepare:

* one architecture brief
* one implementation prompt
* one acceptance test prompt
* one refactor prompt

This keeps agents constrained and reduces drift.

## 13. Claude Code agent prompt pack

Below is a staged prompt series designed for Claude Code. Each prompt assumes the agent works in a docs-first, test-backed workflow and must avoid architectural drift.

### Prompt 0 — Read context and produce implementation plan

```text
You are working on TensorScope, a React/TypeScript scientific visualization application for tensor-centric neurophysiology data exploration.

Your task in this step is NOT to implement code yet. Your task is to read the existing code and docs, then produce a concrete implementation plan for the first milestone.

## Product framing
TensorScope is not a generic plotting app. It is a tensor-centric visualization workspace built around:
- shared selection state
- linked views
- multiscale time navigation
- view and tensor registries
- CPU-first rendering with optional GPU acceleration later

## First milestone
Milestone M1 — Linked Multiscale Explorer

This milestone should include:
- central shared selection state
- high-performance timeseries plot using uPlot
- Bokeh-style interaction toolbar: pan, box zoom, wheel zoom, reset
- overview/detail synchronization
- event track
- linked spectrogram placeholder or minimal implementation
- minimal tensor registry and view registry stubs

## Your tasks
1. Read the relevant code and docs.
2. Summarize the current GUI architecture and where it already aligns with the target architecture.
3. Identify missing architectural pieces.
4. Propose an implementation sequence broken into small PR-sized steps.
5. List key risks and invariants.
6. Do not modify files yet.

## Required output format
Return a markdown document with these sections:
- Current state
- Gaps to target architecture
- Proposed milestone decomposition
- File/module plan
- Risks and guardrails
- Recommended first implementation step

## Constraints
- Prefer existing architecture where viable.
- Do not propose large rewrites unless necessary.
- Optimize for future extensibility.
- Keep hot rendering paths outside React render loops.
```

### Prompt 1 — Define core domain types and state contracts

```text
You are implementing the foundational domain model for TensorScope.

## Goal
Create the TypeScript types and interface contracts for the shared state and registry system, without overcommitting to advanced features.

## Required concepts
Implement type definitions for:
- Dimension identifiers
- Coordinate selectors
- Time range and cursor
- Channel / spatial selections
- Frequency selection
- Event selection
- SelectionState
- TensorDescriptor
- TensorSchema
- ViewDescriptor
- ViewInstanceState
- LayoutPreset

## Deliverables
Create or update files that define:
- core domain types
- runtime-safe schema boundaries where appropriate
- comments/docstrings describing intended semantics

## Requirements
- Use TypeScript strictly.
- Prefer discriminated unions where they clarify behavior.
- Keep the model minimal but extensible.
- Avoid premature generalization.
- Make the difference explicit between navigation state, view-local state, and processing state.

## Acceptance criteria
- Types are coherent and composable.
- The selection model can support current UI plus future linked views.
- A future Zustand store can use these contracts directly.

## Output
1. Implement the types.
2. Add a short developer note summarizing design choices.
3. Do not yet implement full app behavior.
```

### Prompt 2 — Implement SelectionState store with tests

```text
You are implementing the central shared selection store for TensorScope.

## Goal
Build a Zustand-based SelectionState store that becomes the canonical coordination layer across views.

## Scope
Implement:
- store state
- actions
- selectors where useful
- serialization/deserialization hooks if lightweight
- unit tests

## Core state
The store should at minimum support:
- timeRange
- timeCursor
- selectedChannels
- selectedSpatialSite or spatial selection
- frequency selection
- selectedEventId
- activeTensorId
- activeLayoutId

## Core actions
Implement actions such as:
- setTimeRange
- setTimeCursor
- setSelectedChannels
- toggleSelectedChannel
- setFrequencyRange
- setSelectedEvent
- setActiveTensor
- setActiveLayout
- resetSelection

## Requirements
- Zustand with TypeScript
- tests for update semantics
- avoid unnecessary complexity
- state updates should be predictable and explicit

## Acceptance tests to include
- updating timeRange does not clobber unrelated selections
- selecting an event can update selectedEventId without corrupting time state
- toggling channels behaves deterministically
- resetSelection restores defaults

## Constraints
- Keep store domain-focused, not UI-hack focused.
- Do not include heavy derived computation here.
```

### Prompt 3 — Refactor current UI into workspace shell boundaries

```text
You are refactoring the TensorScope UI architecture to support future growth.

## Goal
Create a workspace-shell structure that separates:
- app shell
- navigation state
- workspace views
- contextual inspectors
- processing controls

## Target architecture
Create clear component boundaries for:
- TopBar
- LeftRail or LeftSidebar
- WorkspaceRegion
- RightInspector
- optional StatusBar

## Requirements
- Preserve existing functionality as much as possible.
- Do not redesign everything visually from scratch.
- Introduce structural separation first.
- Keep the existing current GUI recognizable.
- Make future view swapping and layout presets easier.

## Implementation tasks
1. Identify current monolithic components.
2. Extract layout shell components.
3. Move controls into conceptually correct regions.
4. Keep styles coherent.
5. Add comments explaining intended responsibilities.

## Acceptance criteria
- The screen is still functional.
- Layout regions are explicit in code.
- Future registry-driven views can be mounted in WorkspaceRegion.
- Navigation vs processing controls are no longer conflated.
```

### Prompt 4 — Build uPlot TimeseriesView foundation

```text
You are implementing the reusable timeseries foundation for TensorScope using uPlot.

## Goal
Create a TimeseriesView component that is high-performance, React-safe, and ready for linked interaction.

## Requirements
- React + TypeScript
- uPlot instance created once and stored in a ref
- direct scale updates through uPlot APIs
- no React rerender loop during drag interactions
- support large timeseries efficiently

## Props
Design a clean props interface that can support:
- x values
- one or more y series
- optional channel labels
- current selection overlays
- callbacks for cursor/range changes

## Deliverables
- TimeseriesView component
- supporting hook/utilities as needed
- developer comments explaining lifecycle decisions

## Constraints
- Do not use a heavy React chart wrapper.
- Keep the hot path imperative.
- Prepare the component for linked overview/detail usage later.

## Acceptance criteria
- chart mounts and unmounts cleanly
- data updates are handled safely
- component can be reused for overview and detail views
```

### Prompt 5 — Add Bokeh-style gesture toolbar to TimeseriesView

```text
You are implementing Bokeh-style interaction tools for the TensorScope TimeseriesView.

## Goal
Add a lightweight floating toolbar that supports:
- pan
- box zoom
- wheel zoom toggle
- reset

## Required behavior
- Pan mode: horizontal drag translates the x-scale via u.setScale
- Zoom mode: native uPlot drag selection performs box zoom on x
- Wheel zoom: zoom relative to cursor position
- Reset: restore initial x extent

## Requirements
- keep interaction state local and efficient
- do not recreate the uPlot instance on tool changes
- use refs for imperative interaction state
- keep toolbar styling lightweight and consistent with the dark UI

## Acceptance criteria
- pan and zoom do not conflict
- wheel zoom can be toggled on/off
- reset always returns to initial extent
- interaction remains smooth

## Output
Implement the feature and include a short note explaining key interaction decisions.
```

### Prompt 6 — Implement overview/detail linked navigation

```text
You are implementing the multiscale navigation core of TensorScope.

## Goal
Create a linked overview/detail arrangement where the top overview controls the detail window.

## Required behavior
- overview shows larger temporal context
- detail shows the current zoomed region
- brushing or selecting in overview updates detail range
- panning/zooming in detail can update shared selection state
- both views remain synchronized through the shared store

## Requirements
- use the SelectionState store as the coordination layer
- avoid ad hoc direct component coupling
- keep performance strong on large traces

## Deliverables
- overview view wiring
- detail view wiring
- synchronization logic
- tests for synchronization semantics if practical

## Acceptance criteria
- overview and detail remain in sync
- changing time range in one place propagates correctly
- architecture is reusable for other linked views later
```

### Prompt 7 — Add minimal event track and event selection flow

```text
You are implementing the first event-aware navigation layer in TensorScope.

## Goal
Introduce an event track and a minimal event selection model that integrates with the shared selection state.

## Scope
Implement:
- event data shape or descriptor
- event track view in the timeline/workspace
- click-to-select event
- optional event list in inspector or side panel
- synchronization with time selection

## Required behavior
- selecting an event updates selectedEventId
- selecting an event recenters or focuses the detail time window
- the event track visually indicates the active event

## Constraints
- keep the model simple
- do not build the full event browser yet
- design so multiple event streams can exist later

## Acceptance criteria
- event selection is visible in UI and shared state
- time navigation can respond to event selection
- code is structured for later event stream expansion
```

### Prompt 8 — Introduce minimal TensorRegistry and ViewRegistry stubs

```text
You are implementing the first registry-based abstractions for TensorScope.

## Goal
Move the app one step away from a hardcoded plot page and toward a tensor-centric workspace.

## Scope
Implement minimal but real versions of:
- TensorRegistry
- ViewRegistry
- compatibility matching between tensor schemas and view types
- registration for currently existing views

## Requirements
- keep the initial implementation small
- do not build a plugin framework yet
- support the current tensor metadata header and current views
- ensure future view addition is straightforward

## Deliverables
- registry types
- registry data structures or helper APIs
- one or two example registrations
- comments explaining extension points

## Acceptance criteria
- app can query what views are available for a tensor
- current timeseries and spatial map can fit into the model
- no large rewrite required to adopt the registry stubs
```

### Prompt 9 — Build inspector model and move context-sensitive controls there

```text
You are refining the TensorScope UI so it can scale to more views cleanly.

## Goal
Create a context-sensitive inspector panel for the active view or current selection.

## Motivation
The current sidebar mixes navigation controls, processing controls, and view-specific options. We want a cleaner architecture.

## Scope
Implement a RightInspector model that can show:
- selected event details
- selected channel/electrode info
- active view options
- transform parameters for the focused context

## Requirements
- keep existing UI mostly intact where possible
- start with one or two inspector sections only
- define clean extension boundaries for future inspectors

## Acceptance criteria
- at least one set of controls moves out of the monolithic sidebar
- the inspector updates based on active context
- architecture becomes cleaner for future development
```

### Prompt 10 — Add architectural docs and ADRs for the new structure

```text
You are documenting the TensorScope architecture after the first implementation wave.

## Goal
Write concise docs and ADRs so future agents and developers can extend the app consistently.

## Required docs
Write or update docs covering:
- workspace-shell architecture
- distinction between navigation state, view state, and processing state
- why uPlot is used for timeseries
- why shared SelectionState is central
- how TensorRegistry and ViewRegistry are intended to evolve

## Required ADRs
Create short ADRs for:
1. React + TypeScript + Zustand foundation
2. uPlot as timeseries renderer
3. workspace-shell architecture
4. CPU-first with optional GPU acceleration

## Constraints
- be concise and practical
- document current reality, not fantasy architecture
- include extension guidance for future agents
```

### Prompt 11 — Integration pass for Milestone M1

```text
You are performing the integration pass for TensorScope Milestone M1: Linked Multiscale Explorer.

## Goal
Integrate the current components into one coherent demo-quality milestone.

## Milestone scope
M1 should include:
- workspace shell boundaries
- shared SelectionState store
- overview/detail linked timeseries navigation
- Bokeh-style gesture tools
- event track with event selection
- minimal inspector behavior
- minimal tensor/view registry stubs

## Your tasks
1. Identify mismatches between modules.
2. Resolve naming inconsistencies.
3. Ensure shared state flows are coherent.
4. Tighten UI polish modestly without overdesigning.
5. Add or update tests where critical.
6. Summarize remaining gaps to Phase 5+ goals.

## Acceptance criteria
- the milestone is usable and coherent
- the architecture is cleaner than the starting point
- future linked views can be added without major rewrites

## Output
- code updates
- a milestone summary note
- a short list of next recommended steps
```

## 14. Recommended execution order

Use the prompts in this order:

1. Prompt 0 — planning pass
2. Prompt 1 — core types
3. Prompt 2 — selection store
4. Prompt 3 — workspace shell refactor
5. Prompt 4 — timeseries foundation
6. Prompt 5 — gesture toolbar
7. Prompt 6 — overview/detail sync
8. Prompt 7 — event track
9. Prompt 8 — registries
10. Prompt 9 — inspector
11. Prompt 10 — docs + ADRs
12. Prompt 11 — milestone integration pass

## 15. Operator notes for using Claude Code effectively

When running these prompts:

* ask for a plan before edits on larger prompts
* keep each run scoped to one prompt
* after each prompt, review diff before proceeding
* require tests or at least explicit validation notes
* avoid asking one agent run to solve architecture and implementation and polish at once
* maintain a rolling context snapshot doc for future agent sessions

## 16. Suggested review checklist after each prompt

Use this checklist after each Claude Code run:

* Did it preserve the tensor-centric direction?
* Did it keep shared state central?
* Did it avoid React hot-path performance mistakes?
* Did it reduce or increase coupling?
* Did it introduce hardcoded layout assumptions?
* Did it document new extension points?
