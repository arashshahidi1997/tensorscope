# Prompt 05: Gesture Toolbar

Read first:

- [00_context.md](./00_context.md)
- [../context_snapshot.md](../context_snapshot.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)
- [04_timeseries_view.md](./04_timeseries_view.md)

Goal: separate gesture/tool mode control from raw timeseries rendering.

Inspect first:

- [frontend/src/components/views/TimeseriesSliceView.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/TimeseriesSliceView.tsx)

Scope:

- pan / zoom / reset tool surface
- minimal toolbar state wiring
- integrate with the timeseries view without recreating the chart instance

Guardrails:

- tool state is view-local unless it is truly shared navigation
- avoid embedding more mode logic directly inside the render lifecycle

Acceptance:

- gesture mode switching is clearer
- the toolbar does not destabilize the chart lifecycle
- reset behavior is explicit and testable
