# ADR-0009: Navigation Ownership (client-authoritative, stateless slicer, async pairing projection)

## Title

Navigation state is client-authoritative; the server is a stateless slicer plus
a thin, eventually-consistent selection projection used only for pairing/sharing.

## Status

Proposed. Resolves the direction of `refactor-plan.md` **D1** (Tier 3 —
explicitly a human decision, not swarm work). Builds on
[ADR-0007](./0007-unified-time-transport.md) (one `{cursor, window}` owner,
optimistic cursor, debounced fetch) and refines
[ADR-0004](./0004-shared-selectionstate-coordination.md) (shared SelectionState
as the coordination layer). **Not yet Accepted:** the pairing-direction open
question below must be settled first, and only the cursor leg (ADR-0007) + N5
are implemented today.

## Context

Selection is currently **dual-owned**. It lives client-side in
`useSelectionStore` (Zustand), *and* every navigation change also does an HTTP
round-trip to `PUT /api/v1/selection`, which the server persists in the session
(`ServerState`) before React Query invalidates and refetches. This is the root
of the "round-trip family of issues" D1 names:

- Two latency paths for one gesture (the local store update is instant; the
  selection PUT is a blocking network hop that gates the refetch).
- Two authoritative copies that can diverge — the staleness class N2 had to
  surface with explicit badges rather than prevent.
- Wasteful recompute on interaction-frequency events (pan/scrub).

Two facts make a cleaner split possible:

1. **The slice path is already effectively stateless.** `apply_slice_request`
   slices from the `TensorSliceRequestDTO` body (`time_range`, `psd_params`,
   mask, …), not from session-held navigation. The server does not *need*
   authoritative selection to serve a slice.
2. **The app is single-user and RAM-resident.** There is no multi-writer
   concurrency requiring the server as the arbiter of "where the user is
   looking."

The one genuine reason the server currently knows the selection is **pairing**
(`contract-v2.md` §5; the pairing-v1 work): Python pairing clients share the
session's view. That need is real, but it is a *publish/subscribe* need, not a
*round-trip-on-every-change* need.

ADR-0007 already moved the **cursor** to optimistic client-first updates and a
debounced fetch edge. This ADR generalizes that principle to *all* navigation
and names where the owner lives.

## Decision

**Do not split ownership of the same state between client and server** — that is
the trap in "a mix," and it reproduces the divergence N2 papers over. Instead,
one source of truth per concern, with the boundary drawn by *what the data
depends on* and *who else needs to know*:

| Concern | Owner | Rationale |
|---|---|---|
| cursor / window / zoom / hover / freq / active-event | **client** (`useSelectionStore` + URL/localStorage) | interaction-frequency; must never round-trip just to update state |
| slicing / processing / transforms | **server, stateless** | already keyed by an explicit, self-describing request body; holds no session navigation state |
| "current view" for pairing/share | **server, async projection** | the one legitimate cross-client need — but a debounced, off-critical-path *subscriber*, not a source of truth |

Concretely:

1. **Client is authoritative for navigation.** The Zustand store (the shared
   SelectionState of ADR-0004) is the single source of truth. Persistence/restore
   is client-side via URL + localStorage (`contract-v2.md` Phase 4 F25), not the
   server session.
2. **Server stays a stateless slicer.** Slice requests fully self-describe; the
   server never reads session navigation to decide what to slice.
3. **Pairing reads a projection, not the hot path.** When pairing/sharing is
   active, the client *publishes* its selection to the server — debounced
   (~100 ms), fire-and-forget, idempotent — and pairing clients read/subscribe
   to that projection. This publish never gates a slice fetch.

## Consequences

- `PUT /api/v1/selection` leaves the navigation critical path: it becomes the
  debounced pairing-publish (or is removed entirely if pairing is observe-only
  via a dedicated channel). A slice fetch no longer waits on a selection commit.
- **N5 (done) and ADR-0007 are the first concrete steps**, independent of the
  rest: the cursor is already client-optimistic, and window-bound query keys no
  longer re-key on a pure cursor move. Nothing here contradicts them.
- Future agents should treat as regressions: a synchronous selection round-trip
  that gates a slice fetch; two authoritative selection copies that can drift;
  the server reading session navigation in order to slice.
- Refines ADR-0004 (the client store *is* the shared coordination layer; this
  does not reintroduce view-to-view coupling) and extends ADR-0007 ("one owner"
  → "the client owns it").

## Open questions (gate Accepted)

1. **Pairing direction — the crux.** Is pairing *observe-only* (Python reads the
   browser's view) or *bidirectional* (Python can also drive the browser)?
   Observe-only is a clean one-way projection. Bidirectional needs a small
   last-writer-wins / echo protocol on the projection, and the client is then no
   longer *unconditionally* authoritative — it must reconcile inbound drives.
   This must be decided before this ADR is Accepted.
2. **Relationship to D2** (generic-tensor selection, `contract-v2.md` Phase 2).
   The coord-dict selection of D2 changes the *shape* of selection but not its
   *ownership*; the two decisions are orthogonal and should stay separate.

## Related docs

- [docs/design/refactor-plan.md](../design/refactor-plan.md) — Tier 3 **D1** (this ADR resolves its direction).
- [ADR-0007: Unified time-transport](./0007-unified-time-transport.md) — the cursor/window owner this generalizes.
- [ADR-0004: Shared SelectionState](./0004-shared-selectionstate-coordination.md) — the coordination layer this refines.
- [docs/design/contract-v2.md](../design/contract-v2.md) — §5 pairing coordination; Phase 4 F25 URL persistence.
- [docs/research/time-transport-survey.md](../research/time-transport-survey.md) — how mature single-user viewers own navigation.
