# TensorScope Agent Runbook

Use this runbook for safe, repeatable coding-agent sessions in TensorScope.

Related docs:

- [Prompt docs guide](./README.md)
- [Context snapshot](./context_snapshot.md)
- [Prompt registry](./prompt_registry.md)
- [Architecture overview](../architecture/tensorscope.md)
- [Architecture invariants](../architecture/invariants.md)

## What to read before any major task

Read these before architecture-sensitive work:

1. [../architecture/tensorscope.md](../architecture/tensorscope.md)
2. [../architecture/invariants.md](../architecture/invariants.md)
3. [context_snapshot.md](./context_snapshot.md)
4. the relevant milestone README:
   - [M1 README](./tensorscope/README.md)
   - [M2 README](./tensorscope-m2/README.md)
5. the target prompt from the correct pack

Use [prompt_registry.md](./prompt_registry.md) to choose the next bounded prompt.

## How to start a session

Recommended session start sequence:

1. state the target milestone and prompt
2. ask the agent to inspect the referenced code first
3. ask for a short plan before edits
4. confirm the task is docs-only or code-changing
5. ask for a brief summary of affected files before patching

## How to ask for a plan before edits

Preferred pattern:

- inspect the current files first
- summarize relevant repo state
- identify mismatches or risks
- present a short edit or implementation plan
- only then edit files

This is especially important for:

- architecture docs
- store boundaries
- registry work
- view coordination changes
- milestone-integration tasks

## How to review proposed file changes

Before the agent patches files, ask for:

- the file list
- the role of each file in the change
- any assumptions being made about current repo state
- any expected docs that will need syncing after the change

For larger tasks, prefer one bounded patch set over a broad multi-area rewrite.

## How to validate architecture alignment

Check each substantial change against these questions:

- does it preserve shared navigation state as the coordination mechanism?
- does it avoid direct view-to-view coupling?
- does it keep navigation, view-local, and processing state separate?
- does it avoid React rerender loops in hot rendering paths?
- does it preserve CPU-first behavior?
- does it fit the milestone boundary instead of leaking into later milestones?

If the answer to any of these is unclear, pause and tighten the plan before editing.

## When to update architecture docs

Update [../architecture/tensorscope.md](../architecture/tensorscope.md) when:

- state boundaries change
- shell responsibilities change
- registry structure changes
- a milestone changes what is considered implemented
- a renderer or data-flow decision becomes materially more concrete

Update [context_snapshot.md](./context_snapshot.md) when:

- milestone status changes
- important files to inspect first change
- major architecture anchors move
- open questions change materially

Do both in the same session when the architectural reality changed, not later.

## How to move from one prompt to the next

Recommended workflow:

1. finish one scoped prompt
2. verify whether its acceptance criteria were actually met
3. sync architecture/context docs if needed
4. update any milestone README or prompt registry only if the milestone structure changed
5. choose the next prompt from the same pack unless there is a clear reason to stop or reprioritize

Do not skip forward casually across milestones. Finish the current milestone contract first.

## How to handle ambiguity

When the repo and docs disagree:

- trust direct code inspection over stale descriptive docs
- record the mismatch explicitly
- prefer minimal corrective edits

When prompt dependencies are unclear:

- use the milestone README and prompt registry as the default order
- only reorder if the codebase already satisfies the earlier dependency

When a major design question is unresolved:

- document it
- avoid locking in speculative architecture as if it were settled
- prefer a narrow local change over a premature framework decision

## How to avoid architectural drift

- keep tasks single-run sized
- avoid implementing architecture cleanup and major product features in the same pass
- prefer shared contracts over ad hoc exceptions
- update docs when architecture changes materially
- check decisions against [../architecture/invariants.md](../architecture/invariants.md) before merging broad changes

## Recommended workflow for milestone packs

For M1:

- follow [./tensorscope/README.md](./tensorscope/README.md)
- keep the focus on state, shell, linked navigation, and first-pass coordination contracts

For M2:

- follow [./tensorscope-m2/README.md](./tensorscope-m2/README.md)
- keep the focus on chunked data access, LOD, scientific views, and CPU-first rendering evolution

Do not mix M2 scalability/view work into unfinished M1 architecture tasks unless the repo clearly already satisfies the M1 boundary.

## Session start template

Use or adapt this:

```text
You are working in the TensorScope repository.

Target milestone/prompt: <prompt path>

Before editing:
1. inspect the current repo files relevant to this task
2. summarize current state and any mismatches with the prompt
3. present a short plan and file list
4. then proceed with focused edits

Validate the work against:
- docs/architecture/tensorscope.md
- docs/architecture/invariants.md
- docs/prompts/context_snapshot.md

If the architectural reality changes materially, update the architecture doc and context snapshot in the same session.
```

## Post-change checklist

- did the change stay within one prompt's scope?
- were the relevant files inspected before editing?
- do the changes still match the architecture overview and invariants?
- were any milestone or architecture assumptions changed?
- if yes, were `tensorscope.md` and `context_snapshot.md` updated?
- is the next prompt now clear from the milestone README and prompt registry?
