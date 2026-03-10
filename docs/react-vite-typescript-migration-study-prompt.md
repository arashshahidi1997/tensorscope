# TensorScope Migration Study Prompt

Use this prompt in a fresh coding-agent session when the goal is to study the current TensorScope codebase and produce a grounded migration plan toward `React + Vite + TypeScript`, while preserving Python for core compute.

---

## Prompt

You are reviewing the standalone `tensorscope` project with the goal of planning a migration to `React + Vite + TypeScript` for the app/frontend layer, while keeping Python for core compute, tensor transforms, data loading, and scientific logic.

### Project context

- Repo under study: `/storage2/arash/projects/tensorscope`
- Related scientific library: `/storage2/arash/projects/cogpy`
- In this repo, `resources/cogpy` is a symlink to the `cogpy` project:
  - `/storage2/arash/projects/tensorscope/resources/cogpy -> /storage2/arash/projects/cogpy`
- Important framing:
  - TensorScope is a product/tool in its own right.
  - PixECoG is only one host project that may use TensorScope.
  - Do not assume TensorScope should remain embedded inside `cogpy`.
  - Treat `cogpy` as a related scientific/compute library and likely integration dependency, not as the owner of TensorScope.

### High-level objective

Study and understand the current TensorScope implementation lineage, the current minimal standalone repo, and the relevant TensorScope-related code in `cogpy`, then produce a concrete migration study for a future architecture based on:

- React
- Vite
- TypeScript
- Python backend/core compute

This is a study, architecture, and planning task first. Do not start by writing the React app. Build a clear understanding and propose the correct structure and boundaries.

### What to study

1. The current standalone `tensorscope` repo structure and current package surface.
2. The TensorScope implementation and docs that already exist inside `cogpy`, especially anything under:
   - `resources/cogpy/.../tensorscope`
   - TensorScope-related docs, specs, plans, guides, and examples
3. The current architectural concepts already explored:
   - tensor-centric state
   - selection state
   - layers/modules/views split
   - event systems
   - transforms
   - layout management
   - plugin/extensibility ideas
4. Which parts are:
   - product-domain concepts that belong in TensorScope
   - scientific compute/data utilities that should live in `cogpy`
   - legacy or experimental code that should not define the future architecture
5. Whether the current or historical Panel/HoloViews approach should be:
   - retired
   - wrapped temporarily
   - or kept only for prototyping/internal debugging

### Required questions to answer

Your study must answer these clearly:

1. What is the current real architecture of TensorScope across `tensorscope` and `cogpy`?
2. Which existing concepts are worth preserving in the migration?
3. Which current abstractions should be removed or collapsed?
4. What should be the package/repo relationship between `tensorscope` and `cogpy`?
5. What should be the frontend/backend boundary in a React + Vite + TypeScript architecture?
6. What data model should the frontend consume?
7. What API shape should the Python side expose to support the frontend?
8. Which parts of the current code can be reused directly, adapted, or archived?
9. What migration phases would minimize architectural confusion?
10. What are the main technical risks and how should they be mitigated?

### Constraints

- Prefer codebase-first reasoning over generic framework advice.
- Do not assume TensorScope should stay under a `cogpy.core.plot.*` namespace.
- Do not optimize for minimal migration effort; optimize for a strong long-term architecture.
- Distinguish clearly between:
  - reusable scientific compute
  - app state / UI state
  - transport/API contracts
  - frontend presentation
- Be explicit about what should remain Python-only and what should move to TypeScript.
- Assume TensorScope may later be used by projects other than PixECoG.

### Deliverables

Produce a concise but concrete study with the following sections:

1. `Current State`
   - Summarize what exists now in `tensorscope`
   - Summarize the relevant TensorScope implementation lineage in `cogpy`
   - Identify the current canonical code vs legacy/historical code

2. `Core Concepts To Preserve`
   - List the concepts worth keeping through the migration
   - Explain why each should survive the stack change

3. `Recommended Target Architecture`
   - Propose repo/package structure
   - Propose frontend structure
   - Propose Python backend/core structure
   - Propose integration boundary with `cogpy`

4. `Ownership Boundaries`
   - What belongs in `tensorscope`
   - What belongs in `cogpy`
   - What belongs in host projects like PixECoG

5. `Migration Plan`
   - Phase 0: study/stabilize boundary
   - Phase 1: extract reusable Python core
   - Phase 2: define API contracts
   - Phase 3: scaffold React/Vite/TS frontend
   - Phase 4: migrate one canonical workflow
   - Phase 5: retire legacy UI paths

6. `Risks and Open Questions`
   - Include technical, packaging, performance, and developer-experience risks

### Expected level of specificity

Be concrete enough that the result could directly guide the next implementation prompt.

Where helpful, include proposed directory layouts such as:

```text
tensorscope/
  src/tensorscope/
  frontend/
  tests/
  docs/
```

and package boundaries such as:

```text
tensorscope -> optional cogpy adapters
pixecog -> tensorscope
pixecog -> cogpy
```

### Working style

- Start by reading the local repo.
- Read only the TensorScope-relevant parts of `cogpy`.
- Prefer identifying the actual current canonical path over trusting old specs blindly.
- When old docs conflict with implementation, say so explicitly.
- Separate facts from recommendations.
- Quote file paths and line references where useful.

### Final instruction

Do not implement the migration yet. Deliver the study, target architecture, and phased migration recommendation only.

