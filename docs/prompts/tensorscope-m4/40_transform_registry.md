# Prompt 40: Transform Registry

Read first:

- [00_context.md](./00_context.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)
- [../../architecture/invariants.md](../../architecture/invariants.md)

Goal: introduce a `TransformRegistry` system.

Scope:

- register transforms
- define transform inputs and outputs
- declare tensor compatibility

Implementation Tasks:

- define the minimum transform-registry contract
- specify how transforms declare input requirements and output tensor shape
- describe how transforms are discovered by the system
- keep the registry compatible with existing tensor and view registry direction

Constraints:

- transforms must map `input tensor -> derived tensor`
- do not hide compatibility rules inside individual views
- label new modules as planned if this task remains contract-first
- transforms operate in abstract data space; they must not depend on canvas pixel geometry (that belongs in client-side initializers, not server-side or worker transforms)

Acceptance Criteria:

- transforms can be registered and discovered by the system
- transform inputs and outputs are explicit
- compatibility rules are documented rather than implicit
- the registry composes transforms without requiring imports between transform modules

Deliverables:

- prompt-ready transform-registry contract
- explicit registration and discovery rules

## Reference

JupyterLab's plugin token/dependency injection system (`packages/application/src/lab.ts`) is the closest production reference for a transform registry with typed declared inputs and outputs:

```typescript
// JupyterLab pattern — adapted for TensorScope transforms:
const ISpectrogramTransform = new Token<ISpectrogramTransform>(
  '@tensorscope/transforms:ISpectrogramTransform'
);

const spectrogramPlugin: TransformPlugin<ISpectrogramTransform> = {
  id: '@tensorscope/transforms:spectrogram',
  requires: [IRawSignalTensor],   // declared input tensor types
  provides: ISpectrogramTransform, // declared output tensor type
  activate: (registry, rawSignal) => new SpectrogramTransform(rawSignal),
};
```

Key lessons from JupyterLab's implementation:
- `Token<T>` is just a class holding a string and a TypeScript phantom type — zero runtime overhead, makes injection sites type-safe.
- `requires` vs. `optional` dependencies: transforms that can run with incomplete input declare optional deps; this maps to transforms that work on a channel subset vs. requiring all channels.
- **Disposable returns**: every `register()` call returns an `IDisposable` so transforms can be unregistered (useful for hot-module replacement in development and for test cleanup).
- **Two-phase boot**: `register all → activate in dependency order` — the registry resolves the dependency graph before calling `activate()` on any transform; transforms do not import each other directly.

This is the TensorScope analogue of Neuroglancer's annotation type registry from M2: adding a new transform type should require only a new registration call, not editing the registry or downstream view code.

See [docs/reference-studies/jupyterlab.md §2.2 (Token-Based Plugin Registration)](../../reference-studies/jupyterlab.md).

Perspective's side-effect plugin registration (`rust/perspective-viewer/src/ts/extensions.ts`) provides a complementary pattern: `import "@tensorscope/transforms/spectrogram"` triggers self-registration with no explicit registry wiring. Each transform module calls `TransformRegistry.register(spectrogramPlugin)` as an import side effect; application code imports the modules it needs and the registry discovers them automatically — no centralized list that requires manual editing when new transforms are added.

See [docs/reference-studies/perspective.md §2b](../../reference-studies/perspective.md).

Observable Plot's `composeTransform(t1, t2)` pattern provides the mechanism for chaining transforms without coupling them. A composed transform is itself a transform: `bandpower = composeTransform(psd, bandSelect)`. Both transforms remain individually registered and reusable; the composition is a first-class registry entry that records its constituent transforms as provenance. This is the correct primitive for M4's derived-tensor chains (raw signal → spectrogram → band power → spatial map) without building a bespoke DAG scheduler in M4.

See [docs/reference-studies/observable-plot.md §2.2 (Transform vs. Initializer)](../../reference-studies/observable-plot.md).
