I have two more ideas for tensorscope

the visualizations of tensor transforms DAG with toggles in view in display 
raw ecog > filter ecog > prewhiten > spectrogram > ...

and each can be displayed

the second idea is that now with this transform DAG which is effectively a pipeline. We can save into a pipline state file (json or yaml or anything) which given some "cooker" config can be cooked into a snakemake pipeline. again with display active nodes would get a saved file, in the pipeline.

 