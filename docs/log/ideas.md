I have two more ideas for tensorscope

the visualizations of tensor transforms DAG with toggles in view in display 
raw ecog > filter ecog > prewhiten > spectrogram > ...

and each can be displayed

the second idea is that now with this transform DAG which is effectively a pipeline. We can save into a pipline state file (json or yaml or anything) which given some "cooker" config can be cooked into a snakemake pipeline. again with display active nodes would get a saved file, in the pipeline.

> **Shipped 2026-05-07** (commit `7884a88`). YAML/JSON serialise + import-and-replay endpoints with stable user-controlled tensor IDs. Snakemake cooker still emits `Snakefile + config.yaml` via `POST /api/v1/pipeline/export` with `cooker_profile="snakemake"`. Persistent cache, fan-out, and stale-cache visibility deferred (see expert-review §3 follow-ups).

 