# TensorScope Architecture Invariants

Use this document as the short list of architectural rules that should remain true across milestones.

Purpose:

- prevent architectural drift during incremental agent work
- make code-review expectations explicit
- help future agents identify changes that need stronger scrutiny

Read with:

- [tensorscope.md](./tensorscope.md)
- [../prompts/context_snapshot.md](../prompts/context_snapshot.md)
- [../prompts/README.md](../prompts/README.md)

## 1. Shared navigation state is the only cross-view coordination mechanism

What it means:

- views coordinate by reading and updating shared navigation state
- cross-view interactions should flow through the shared store or its server-backed equivalent

Why it matters:

- it keeps linked behavior predictable
- it prevents hidden coupling between views
- it allows new views to join the workspace without custom view-to-view wiring

Common failure modes:

- a view reaches into another view's refs or local state
- one component imports another component's internal handlers to drive updates
- cross-view behavior is implemented as ad hoc callbacks passed through multiple layers

Violating changes:

- direct mutation of another view's internal state
- custom per-pair coordination paths that bypass shared navigation state

## 2. Views must not call each other directly

What it means:

- views publish intent through shared state, shared contracts, or shell-level orchestration
- views do not depend on each other's component internals

Why it matters:

- it preserves modularity
- it keeps view composition flexible
- it reduces breakage when a view is replaced or upgraded

Common failure modes:

- one view imports another view's helper just to trigger navigation
- overlay logic is embedded in one view with assumptions about another view's lifecycle

Violating changes:

- direct component-to-component APIs for coordination
- tight coupling between two views that cannot be removed independently

## 3. Navigation state, view-local state, and processing state must remain distinct

What it means:

- navigation state is shared and serializable
- view-local state belongs to one view
- processing state describes transforms or analysis settings

Why it matters:

- each state class has different lifetime and ownership
- mixing them makes synchronization, persistence, and testing harder
- it prevents tool-mode churn from polluting cross-view state

Common failure modes:

- tool mode stored in shared navigation state
- processing controls mixed into the same store as hover/cursor state
- shell-level store becomes a catch-all for unrelated concerns

Violating changes:

- collapsing all state into one untyped or catch-all store
- storing transient UI state as if it were shared navigation state

## 4. Rendering hot paths must avoid React rerender loops

What it means:

- pointer move, drag, scale, and animation updates should use imperative or lightweight pathways when they are performance-sensitive
- React should orchestrate layout and committed state, not every frame of interaction

Why it matters:

- large scientific views will otherwise lose interactivity
- linked cursor and zoom behaviors depend on low-latency updates

Common failure modes:

- using React state updates on every pointer move
- rebuilding chart instances during drag or wheel interactions
- sending high-frequency hover updates through expensive component trees

Violating changes:

- per-frame rerender loops for crosshair, drag, or animation work
- chart lifecycle designs that recreate the renderer for routine interaction updates

## 5. CPU-first rendering is required; GPU is optional acceleration

What it means:

- every milestone should have a usable CPU path
- GPU support is an optimization or later extension, not a baseline dependency

Why it matters:

- it keeps the architecture implementable and testable early
- it avoids overcommitting to a renderer stack before view/data contracts stabilize

Common failure modes:

- making WebGL the only viable path for a core view
- designing renderer abstractions around hypothetical GPU needs before a stable CPU baseline exists

Violating changes:

- core scientific views that cannot function without GPU-specific infrastructure
- architecture decisions that block a straightforward CPU implementation

## 6. Tensor metadata and view compatibility should move toward explicit registry models

What it means:

- tensor capabilities and schema-to-view matching should be encoded in explicit registry contracts rather than scattered conditionals

Why it matters:

- it makes view availability predictable
- it reduces duplicated capability logic between layers
- it helps future agents extend the system without guessing compatibility rules

Common failure modes:

- view matching scattered across unrelated files
- schema assumptions hard-coded inside multiple view components
- frontend and backend capability logic drifting apart silently

Violating changes:

- adding new view compatibility rules only as local conditionals with no shared contract
- bypassing registry models for major new view categories

## 7. Large data access must be chunked or windowed rather than full-tensor loading

What it means:

- interactive views should request slices, windows, chunks, or reduced summaries instead of materializing entire recordings by default

Why it matters:

- M2 and later milestones depend on interactive behavior on larger recordings
- full-tensor loading will eventually dominate latency and memory costs

Common failure modes:

- fetching the entire tensor to render a narrow time window
- recomputing whole-recording summaries during local navigation
- letting views own ad hoc loading logic with no bounded access contract

Violating changes:

- core view designs that require full-tensor loading for routine interaction
- data APIs that cannot express bounded window requests

## 8. Architecture docs and context snapshot must be updated after major architectural changes

What it means:

- when milestone assumptions, state boundaries, or core contracts change materially, the docs must be updated in the same work stream

Why it matters:

- prompt-driven development depends on accurate handoff documents
- stale architecture docs cause future agents to implement against the wrong model

Common failure modes:

- shipping a new architecture boundary without updating the docs
- leaving milestone status stale after a major integration pass

Violating changes:

- merging major architectural refactors without updating [tensorscope.md](./tensorscope.md) and [../prompts/context_snapshot.md](../prompts/context_snapshot.md)
- changing prompt-pack assumptions while leaving the prompt docs inconsistent

## Ambiguity Notes

Some invariants are still partially ambiguous in the current codebase:

- the exact boundary between committed navigation state and transient shared cursor state will likely tighten further in M2
- registry ownership is still split between backend and frontend, even though the direction toward explicit registry contracts is clear
- chunked/windowed access is a near-term invariant in spirit, but the full M2 data-access layer is not yet implemented everywhere
