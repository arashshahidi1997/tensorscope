# Demo Data

TensorScope can generate a small deterministic local dataset for UI and API testing.

## Generate

```bash
make demo-data
```

This writes the default fixture to:

```text
data/demo_lfp.nc
```

The dataset is built from `cogpy.datasets.tensor.AROscillatorGrid.make`, then normalized to canonical TensorScope dims:

```text
(time, AP, ML)
```

## Use

```bash
make dev-ui
```

or explicitly:

```bash
make dev-ui DATA_PATH=data/demo_lfp.nc
```

The `data/` directory is ignored by git, so local fixtures do not get committed accidentally.
