# JupyterLab — Reference Study

**Repo:** https://github.com/jupyterlab/jupyterlab
**Version studied:** v4.5.6 (latest as of 2026-03-11)
**Date:** 2026-03-11
**Focus:** CommandRegistry, DockPanel layout, plugin registration, StateDB, ISignal — filtered for TensorScope relevance

---

## 1. Repo Overview

JupyterLab is a TypeScript-heavy (86.8%) browser IDE built on two in-house libraries it
created: **@lumino/*** (widget toolkit, command registry, DockPanel, signaling, DI) and the
**packages/** monorepo (~103 npm packages) that composes the application.

The mental model is **micro-frontend via dependency injection**: every feature (file browser,
editor, terminal, inspector, status bar) lives in its own package and communicates only
through declared *Token* interfaces. No package imports another package's implementation
directly.

Frontend-only packages directly relevant to TensorScope:

| Package | Key source path | Role |
|---------|----------------|------|
| `@jupyterlab/application` | `packages/application/src/shell.ts`, `layoutrestorer.ts` | Shell (LabShell), LayoutRestorer, Router, plugin host |
| `@jupyterlab/apputils` | `packages/apputils/src/` | Tokens, WidgetTracker, Toolbar, CommandPalette, Dialogs |
| `@jupyterlab/inspector` | `packages/inspector/src/inspector.ts` | Context/property inspector side panel |
| `@jupyterlab/statedb` | `packages/statedb/src/statedb.ts` | Key-value persistence (IStateDB / StateDB) |
| `@lumino/commands` | (lumino monorepo) | CommandRegistry — standalone, framework-agnostic |
| `@lumino/signaling` | (lumino monorepo) | ISignal / Signal typed event bus |

**Explicitly excluded:** `SessionContext`, comm channels, kernel lifecycle, IOPub messages,
Workspaces API, DocumentRegistry. TensorScope's FastAPI backend is a pull-only REST slice
server; Python never initiates communication with the browser.

---

## 2. Features Worth Borrowing

### 2.1 CommandRegistry — ADOPT

**Source:** `@lumino/commands` (standalone package); integrated in `packages/application/src/lab.ts`
as `app.commands`.

Every user-visible action is a named command with metadata:

```typescript
app.commands.addCommand('tensorscope:zoom-in', {
  label: 'Zoom In',
  caption: 'Increase time resolution',
  isEnabled: () => selectionStore.canZoomIn(),
  execute: () => selectionStore.zoomIn(),
});
app.commands.addKeyBinding({
  command: 'tensorscope:zoom-in',
  keys: ['+'],
  selector: '.ts-chart',   // scope: only fires when a chart has focus
});
```

Key properties:
- `isEnabled` / `isToggled` drive button state reactively — the registry fires a
  `commandChanged` signal that `CommandToolbarButton` subscribes to
  (`packages/ui-components/src/components/toolbar.tsx`).
- Keybindings are selector-scoped and platform-normalised (Mac Cmd vs. Ctrl).
- `addCommand` / `addKeyBinding` both return `IDisposable` — registrations can be
  reversed for hot-module replacement or test cleanup.
- `@lumino/commands` is a standalone npm package; no other Lumino dependency is needed.

**TensorScope use:** replace the current mix of `useChartTools` callbacks and ad-hoc
`onKeyDown` props with a shared `CommandRegistry` instance. All toolbar buttons,
keyboard shortcuts, and a future command palette share a single registry.

### 2.2 Token-Based Plugin Registration — ADOPT (lightweight)

**Source:** `packages/apputils/src/tokens.ts`, `packages/application/src/index.ts`
(`JupyterFrontEndPlugin<T>` interface).

```typescript
// Declaring a typed service token
export const IAnnotationStore = new Token<IAnnotationStore>(
  '@tensorscope/annotations:IAnnotationStore',
  'Shared annotation storage service'
);

// A plugin that provides and consumes services
const plugin: JupyterFrontEndPlugin<IAnnotationStore> = {
  id: '@tensorscope/annotations:plugin',
  autoStart: true,
  requires: [ICommandPalette],   // resolved before activate() is called
  optional: [IThemeManager],     // null if not registered
  provides: IAnnotationStore,
  activate: (app, palette, theme?) => new AnnotationStore(),
};
```

The framework topologically sorts activation order; providers always activate before
consumers. No circular imports, no prop-drilling.

**TensorScope use:** the current `viewRegistry.ts` is already a first-step token registry.
For M3+ shared services (annotation store, frequency-band manager), a `Map<Token, unknown>`
service locator (or React context) with this interface prevents import cycles.

### 2.3 LabShell Rank-Ordered Regions — ADAPT

**Source:** `packages/application/src/shell.ts` — `LabShell` class, `SideBarHandler`,
`PanelHandler`; `packages/mainmenu/src/mainmenu.ts` — `ArrayExt.upperBound` with rank
comparator.

The shell defines named regions (`main`, `left`, `right`, `top`, `bottom`). Adding a
widget is `shell.add(widget, 'right', { rank: 700 })`. All regions use the same
`ArrayExt.upperBound` pattern to maintain stable insertion order by rank integer.
The same pattern appears in status bar items and toolbar contributions.

**TensorScope use:**
- Give each `ChartToolbar` item a `rank: number`; use sorted-insert so new view-specific
  toolbar contributions land at stable positions without modifying existing code.
- Expose `addPanel(area, component, rank)` from `appStore` rather than hardcoding panels
  in `App.tsx`, preparing for M3 panel additions.

### 2.4 WidgetTracker + InspectorPanel / FocusTracker Coupling — ADOPT (pattern)

**Source:** `packages/apputils/src/widgettracker.ts` — `WidgetTracker<T>` / `IWidgetTracker<T>`;
`packages/inspector/src/inspector.ts` — `InspectorPanel`, `IInspector`.

`IWidgetTracker` exposes:
- `currentWidget: T | null` — most-recently-focused widget
- `currentChanged: ISignal<this, T | null>` — fires on focus shift, including disposal

`InspectorPanel` holds a `source: IInspectable | null` property. When the source changes,
the panel disconnects from the old source and connects to the new source's `inspected`
signal. The focused widget pushes `IInspectorUpdate` objects (containing rendered content)
whenever its data changes. The panel just swaps its child widget.

**TensorScope use:** `InspectorPanel` should adopt this contract exactly:
- Each view calls `inspector.setContent(<MyInspectorContent />)` when its internal state
  changes.
- A `focusedViewId: string | null` Zustand slice replaces `currentWidget`.
- `InspectorPanel` subscribes to `focusedViewId`; views update their slot without knowing
  about `InspectorPanel`. No prop-drilling from `App.tsx`.

### 2.5 StateDB Persistence — ADOPT (pattern)

**Source:** `packages/statedb/src/statedb.ts` — `StateDB` / `IStateDB`;
`packages/statedb/src/restorablepool.ts` — `RestorablePool`;
`packages/application/src/layoutrestorer.ts` — `LayoutRestorer`.

Key design decisions:
- IDs follow `"namespace:identifier"` convention; `list(namespace)` queries all items
  under a prefix.
- Pluggable `IDataConnector<string>` backend — default is in-memory; production uses
  `localStorage` or a server endpoint without changing the interface.
- `transform` promise on init supports `'merge'` | `'overwrite'` | `'clear'` — enables
  "restore previous session" vs. "start fresh" semantics.
- `LayoutRestorer` stores `'layout-restorer:data'` and uses widget names to re-execute
  named commands that recreate each widget with its saved arguments.

**TensorScope use:**
- Use `"tensorscope:session"`, `"tensorscope:layout"`, `"tensorscope:view:{viewId}"`
  as localStorage keys from day one.
- Debounce writes to `localStorage` on every selection change via `_layoutDebouncer`
  pattern; restore by calling `initFromDTO` (already in `selectionStore.ts`) on boot.
- The existing `toSelectionDTO` / `initFromDTO` bridges are TensorScope's equivalent of
  StateDB's envelope pattern — they just need a persistence layer underneath.

### 2.6 ISignal Typed Event Bus — ADAPT (discipline only)

**Source:** `@lumino/signaling` package — `Signal<Sender, Args>` implements
`ISignal<Sender, Args>`.

ISignal is a typed, owner-tracked alternative to EventEmitter:

```typescript
// Typed declaration — sender type is part of the signal signature
private _currentChanged = new Signal<this, Widget | null>(this);
get currentChanged(): ISignal<this, Widget | null> { return this._currentChanged; }

// Connection — by object method, not anonymous lambda
tracker.currentChanged.connect(this._onCurrentChanged, this);
// Disconnection — by identity, no handler reference needed
tracker.currentChanged.disconnect(this._onCurrentChanged, this);
```

Ownership tracking disconnects all signals tied to an object on disposal, preventing
memory leaks without maintaining cleanup arrays.

**TensorScope use:** Zustand's `subscribe()` already covers typed subscriptions. The
lesson to borrow is discipline:
- Unsubscribe in every `useEffect` cleanup.
- Pass the *sender* as context when a handler must distinguish sources.
- Never use magic-string events (`'change'`, `'update'`) — always derive subscription
  type from the store slice type.

---

## 3. Patterns to Avoid or Adapt

### 3.1 Lumino Widget / DockPanel as Layout Primitive — SKIP

`DockPanel` is ~3 000 lines of imperative DOM manipulation predating React. It manages its
own virtual-DOM diffing, drag handles, and tab management outside React's reconciler.
Wrapping it requires a `ReactWidget` escape hatch that splits the render tree. TensorScope
should use a React-native layout library (e.g., `react-resizable-panels`) or Tailwind
flex/grid for M3 layout needs. The *patterns* (regions, ranks, trackers) are worth
borrowing; the `Widget` class hierarchy is not.

### 3.2 Full Lumino Application / PluginRegistry class — SKIP

`@lumino/application`'s `Application` and `PluginRegistry` are ~600 lines of
initialization machinery designed to load plugins that each own a DOM root. In a React
app, Zustand context already provides a comparable DI surface. A `Map<symbol, unknown>`
service locator or React context with explicit providers achieves the same effect without
adding Lumino as a dependency.

### 3.3 DocumentRegistry / ModelFactory / WidgetFactory — SKIP

`packages/docregistry/src/registry.ts` provides a three-layer file-type routing system
(file extension → model factory → widget factory). It is designed for a general-purpose
IDE handling arbitrary file types discovered at runtime. TensorScope's view type system
is schema-driven and build-time-fixed (`VIEW_DESCRIPTORS` in `viewRegistry.ts`); this
complexity is not justified.

### 3.4 Full SettingRegistry with AJV schema validation — SKIP for now

`packages/settingregistry/src/settingregistry.ts` uses two AJV instances and a
multi-phase transform pipeline for merging plugin schemas at runtime. This is necessary
when hundreds of extensions each contribute independent schemas. TensorScope's settings
surface is small and known at build time; a typed Zod schema with `localStorage`
persistence is simpler and avoids the AJV bundle cost. The two-phase
`composite` / `user` distinction (section 2 above) is still worth borrowing.

### 3.5 CommandRegistry for every internal state mutation — ADAPT

JupyterLab routes *all* state mutations through the command registry, including trivial
flag toggles. This creates a large, hard-to-audit registry. TensorScope should register
only *user-visible, bindable actions* — not internal Zustand mutations. The rule: if a
user would expect to find it in a command palette or assign a keyboard shortcut to it,
it is a command; otherwise it is a store action.

---

## 4. TensorScope Applicability Summary

| Pattern | Source | TensorScope use | Priority |
|---------|--------|-----------------|----------|
| CommandRegistry (named bindable actions) | `@lumino/commands`, `packages/application/src/lab.ts` | Keyboard shortcuts, toolbar decoupling, future command palette | High |
| Token-based plugin DI | `packages/apputils/src/tokens.ts`, `packages/application/src/index.ts` | M3+ shared services (annotation store, band manager); prevent import cycles | Medium |
| Rank-ordered region slots | `packages/application/src/shell.ts`, `packages/mainmenu/src/mainmenu.ts` | `addPanel(area, rank)` in `appStore`; toolbar item ordering | Medium |
| WidgetTracker / focusedViewId | `packages/apputils/src/widgettracker.ts` | Inspector panel knows which view instance is focused without prop-drilling | High |
| IInspector source-swap pattern | `packages/inspector/src/inspector.ts` | Each view pushes its own inspector content; panel is view-agnostic | High |
| StateDB `namespace:id` + debounced save | `packages/statedb/src/statedb.ts`, `packages/application/src/layoutrestorer.ts` | Session save/restore via localStorage; `initFromDTO` on boot | High |
| `IDisposable` from every registration | Throughout Lumino | Command/view registry cleanup; test isolation; HMR safety | Medium |
| ISignal cleanup discipline | `@lumino/signaling` | Enforce `useEffect` cleanup; typed Zustand subscriptions | Low |
| `composite` vs. `user` settings | `packages/settingregistry/src/settingregistry.ts` | Colormap / downsampling defaults without polluting user config | Low |
| Promise-based `showDialog<T>` | `packages/apputils/src/dialog.tsx` | One-off prompts (epoch name, confirm clear) without callback prop threading | Low |
| Lumino Widget / DockPanel | `packages/application/src/shell.ts` | — skip; use React-native layout instead | Skip |
| DocumentRegistry | `packages/docregistry/src/registry.ts` | — skip; VIEW_DESCRIPTORS already covers TensorScope's needs | Skip |
| SessionContext / kernel lifecycle | `packages/apputils/src/sessioncontext.tsx` | — skip; architecturally incompatible with pull-only REST model | Skip |

---

## 5. Anti-patterns / What Not to Port

**Two competing render trees.** JupyterLab wraps React components in `ReactWidget` to
embed them in the Lumino widget tree. This splits the DOM into Lumino-managed and
React-managed nodes, breaking React context propagation across the boundary and doubling
the event-bubbling surface. Any pattern that requires `ReactWidget` should not be ported.

**Widget lifecycle overrides (`onAfterAttach`, `onBeforeDetach`, `onResize`).** These
Lumino lifecycle hooks are incompatible with React's `useEffect` model and create a
second, parallel component lifecycle. React's `useEffect` + `ResizeObserver` covers the
same ground without the conceptual overhead.

**File-path-based widget restoration.** `LayoutRestorer` assumes widgets are recreated by
executing a command that opens a file path (notebooks, editors). TensorScope views are
derived from a `{ tensorId, viewType, selectionSnapshot }` tuple, not a file path. The
restoration model must be adapted accordingly — the `toSelectionDTO` bridge is already the
right abstraction.

**Notebook-centric "current widget" semantics.** JupyterLab's `currentWidget` in the main
area is always a document (notebook, editor, terminal). In TensorScope, multiple views can
be active simultaneously and none is "the document". The relevant analogue is
`focusedViewId` — which view instance most recently received user interaction — not a
single current document.

**Over-engineering the command palette in M2.** The `ICommandPalette` plugin includes
fuzzy search, category grouping, and keyboard-first UX. This is high value but only after
the core view set is stable. The command registry itself (without the palette UI) delivers
immediate benefit and costs ~2 kB; the palette UI can be added later as a thin layer on
top of the already-registered commands.
