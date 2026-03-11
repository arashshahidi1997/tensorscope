# ADR-0006: Staged Prompt-Pack Development Model

## Title

Staged prompt-pack development model

## Status

Proposed

## Context

TensorScope is being developed through milestone-oriented prompt packs. This approach is already reflected in the docs structure (`M1`, `M2`) but should remain adjustable as the project grows.

## Decision

Organize agent work into staged prompt packs with milestone-level READMEs, scoped prompts, and supporting architecture/context docs.

## Consequences

- large roadmap items can be broken into bounded agent tasks
- architectural expectations can be restated per milestone without duplicating the full roadmap
- future milestones can be added without rewriting earlier packs, but the pack structure should stay lightweight

## Related docs

- [Prompt docs guide](../prompts/README.md)
- [Prompt registry](../prompts/prompt_registry.md)
- [M1 prompt pack](../prompts/tensorscope/README.md)
- [M2 prompt pack](../prompts/tensorscope-m2/README.md)
