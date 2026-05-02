"""Tests for M4 transform registry, derived tensors, and executor."""

from __future__ import annotations

import numpy as np
import pytest
import xarray as xr

from tensorscope.core.state import TensorNode, TensorRegistry
from tensorscope.core.transforms.builtins import (
    BANDPASS,
    BANDPOWER,
    BUILTIN_TRANSFORMS,
    COHERENCE,
    DIM_REDUCTION,
    EVENT_ALIGN,
    PREWHITEN,
    PSD,
    SPECTROGRAM,
    register_builtins,
)
from tensorscope.core.transforms.cache import TransformCache
from tensorscope.core.transforms.executor import TransformExecutor
from tensorscope.core.transforms.model import DerivedTensor, TransformProvenance
from tensorscope.core.transforms.registry import (
    InputSpec,
    OutputSpec,
    ParamSpec,
    TransformDefinition,
    TransformRegistry,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_grid_tensor(name: str = "signal", n_time: int = 200, n_ap: int = 2, n_ml: int = 3) -> TensorNode:
    """Create a (time, AP, ML) test tensor."""
    rng = np.random.default_rng(42)
    fs = 100.0
    time = np.arange(n_time) / fs
    data = xr.DataArray(
        rng.standard_normal((n_time, n_ap, n_ml)),
        dims=("time", "AP", "ML"),
        coords={"time": time, "AP": list(range(n_ap)), "ML": list(range(n_ml))},
        attrs={"fs": fs},
    )
    return TensorNode(name=name, data=data)


def _make_flat_tensor(name: str = "signal_flat", n_time: int = 200, n_ch: int = 6) -> TensorNode:
    """Create a (time, channel) test tensor."""
    rng = np.random.default_rng(42)
    fs = 100.0
    time = np.arange(n_time) / fs
    data = xr.DataArray(
        rng.standard_normal((n_time, n_ch)),
        dims=("time", "channel"),
        coords={"time": time, "channel": list(range(n_ch))},
        attrs={"fs": fs},
    )
    return TensorNode(name=name, data=data)


# ---------------------------------------------------------------------------
# TransformProvenance
# ---------------------------------------------------------------------------

class TestTransformProvenance:
    def test_round_trip(self):
        prov = TransformProvenance(
            transform_name="spectrogram",
            params={"window_s": 0.5, "overlap": 0.25},
            parent_ids=("signal",),
        )
        d = prov.to_dict()
        restored = TransformProvenance.from_dict(d)
        assert restored.transform_name == prov.transform_name
        assert restored.params == prov.params
        assert restored.parent_ids == prov.parent_ids

    def test_cache_key_deterministic(self):
        prov1 = TransformProvenance("psd", {"window_s": 1.0}, ("signal",))
        prov2 = TransformProvenance("psd", {"window_s": 1.0}, ("signal",))
        assert prov1.cache_key() == prov2.cache_key()

    def test_cache_key_varies_with_params(self):
        prov1 = TransformProvenance("psd", {"window_s": 1.0}, ("signal",))
        prov2 = TransformProvenance("psd", {"window_s": 2.0}, ("signal",))
        assert prov1.cache_key() != prov2.cache_key()


# ---------------------------------------------------------------------------
# DerivedTensor
# ---------------------------------------------------------------------------

class TestDerivedTensor:
    def test_round_trip(self):
        prov = TransformProvenance("bandpass", {"lo_hz": 1.0, "hi_hz": 50.0}, ("signal",))
        dt = DerivedTensor(
            id="bp_signal",
            provenance=prov,
            dims=("time", "AP", "ML"),
            shape=(200, 2, 3),
            dtype="float64",
            status="computed",
        )
        d = dt.to_dict()
        restored = DerivedTensor.from_dict(d)
        assert restored.id == dt.id
        assert restored.provenance.transform_name == "bandpass"
        assert restored.dims == dt.dims
        assert restored.shape == dt.shape
        assert restored.status == "computed"

    def test_auto_cache_key(self):
        prov = TransformProvenance("psd", {}, ("signal",))
        dt = DerivedTensor(id="psd_sig", provenance=prov, dims=("freq",), shape=(100,), dtype="float64")
        assert dt.cache_key is not None
        assert dt.cache_key == prov.cache_key()

    def test_is_computed(self):
        prov = TransformProvenance("psd", {}, ("signal",))
        dt = DerivedTensor(id="psd_sig", provenance=prov, dims=("freq",), shape=(100,), dtype="float64")
        assert not dt.is_computed
        dt.status = "computed"
        assert dt.is_computed
        dt.status = "materialized"
        assert dt.is_computed


# ---------------------------------------------------------------------------
# TransformRegistry
# ---------------------------------------------------------------------------

class TestTransformRegistry:
    def test_register_and_get(self):
        reg = TransformRegistry()
        defn = TransformDefinition(name="test_t", input_spec=InputSpec(required_dims=("time",)))
        reg.register(defn)
        assert "test_t" in reg
        assert reg.get("test_t") is defn

    def test_duplicate_raises(self):
        reg = TransformRegistry()
        defn = TransformDefinition(name="t", input_spec=InputSpec())
        reg.register(defn)
        with pytest.raises(ValueError, match="already registered"):
            reg.register(defn)

    def test_get_missing_raises(self):
        reg = TransformRegistry()
        with pytest.raises(KeyError, match="not found"):
            reg.get("missing")

    def test_list(self):
        reg = TransformRegistry()
        reg.register(TransformDefinition(name="a", input_spec=InputSpec()))
        reg.register(TransformDefinition(name="b", input_spec=InputSpec()))
        assert set(reg.list()) == {"a", "b"}

    def test_unregister(self):
        reg = TransformRegistry()
        reg.register(TransformDefinition(name="x", input_spec=InputSpec()))
        reg.unregister("x")
        assert "x" not in reg

    def test_list_compatible(self):
        reg = TransformRegistry()
        reg.register(TransformDefinition(name="needs_time", input_spec=InputSpec(required_dims=("time",))))
        reg.register(TransformDefinition(name="needs_freq", input_spec=InputSpec(required_dims=("freq",))))
        node = _make_grid_tensor()
        compatible = reg.list_compatible(node)
        names = [d.name for d in compatible]
        assert "needs_time" in names
        assert "needs_freq" not in names

    def test_register_builtins(self):
        reg = TransformRegistry()
        register_builtins(reg)
        assert len(reg) == len(BUILTIN_TRANSFORMS)
        for defn in BUILTIN_TRANSFORMS:
            assert defn.name in reg


# ---------------------------------------------------------------------------
# ParamSpec
# ---------------------------------------------------------------------------

class TestParamSpec:
    def test_validate_default(self):
        spec = ParamSpec(dtype="float", default=1.0)
        assert spec.validate(None) == 1.0

    def test_validate_required(self):
        spec = ParamSpec(dtype="float")
        with pytest.raises(ValueError):
            spec.validate(None)

    def test_validate_min(self):
        spec = ParamSpec(dtype="float", default=1.0, min_value=0.0)
        with pytest.raises(ValueError, match="below minimum"):
            spec.validate(-1.0)

    def test_validate_max(self):
        spec = ParamSpec(dtype="float", default=1.0, max_value=10.0)
        with pytest.raises(ValueError, match="above maximum"):
            spec.validate(20.0)

    def test_validate_choices(self):
        spec = ParamSpec(dtype="str", default="pca", choices=("pca", "umap"))
        assert spec.validate("pca") == "pca"
        with pytest.raises(ValueError, match="not in"):
            spec.validate("tsne")


# ---------------------------------------------------------------------------
# InputSpec
# ---------------------------------------------------------------------------

class TestInputSpec:
    def test_compatible(self):
        spec = InputSpec(required_dims=("time", "AP", "ML"))
        node = _make_grid_tensor()
        assert spec.is_compatible(node)

    def test_incompatible(self):
        spec = InputSpec(required_dims=("freq",))
        node = _make_grid_tensor()
        assert not spec.is_compatible(node)


# ---------------------------------------------------------------------------
# TransformCache
# ---------------------------------------------------------------------------

class TestTransformCache:
    def test_put_and_get(self):
        cache = TransformCache()
        prov = TransformProvenance("test", {}, ("sig",))
        dt = DerivedTensor(id="t", provenance=prov, dims=(), shape=(), dtype="float64", status="computed")
        cache.put(dt)
        assert cache.has(dt.cache_key)
        assert cache.get(dt.cache_key) is dt

    def test_eviction(self):
        cache = TransformCache(max_entries=2)
        for i in range(3):
            prov = TransformProvenance("test", {"i": i}, ("sig",))
            dt = DerivedTensor(id=f"t{i}", provenance=prov, dims=(), shape=(), dtype="f", status="computed")
            cache.put(dt)
        assert len(cache) == 2

    def test_invalidate(self):
        cache = TransformCache()
        prov = TransformProvenance("test", {}, ("sig",))
        dt = DerivedTensor(id="t", provenance=prov, dims=(), shape=(), dtype="f", status="computed")
        cache.put(dt)
        cache.invalidate(dt.cache_key)
        assert not cache.has(dt.cache_key)

    def test_clear(self):
        cache = TransformCache()
        for i in range(5):
            prov = TransformProvenance("test", {"i": i}, ("sig",))
            dt = DerivedTensor(id=f"t{i}", provenance=prov, dims=(), shape=(), dtype="f", status="computed")
            cache.put(dt)
        cache.clear()
        assert len(cache) == 0


# ---------------------------------------------------------------------------
# TransformExecutor
# ---------------------------------------------------------------------------

class TestTransformExecutor:
    def _setup(self):
        treg = TransformRegistry()
        register_builtins(treg)
        tensor_reg = TensorRegistry()
        tensor_reg.add(_make_grid_tensor("signal"))
        tensor_reg.add(_make_flat_tensor("signal_flat"))
        cache = TransformCache()
        executor = TransformExecutor(treg, tensor_reg, cache)
        return executor, tensor_reg

    def test_execute_prewhiten(self):
        executor, _ = self._setup()
        result = executor.execute("prewhiten", ["signal"])
        assert result.status == "computed"
        assert result.provenance.transform_name == "prewhiten"
        assert result.provenance.parent_ids == ("signal",)
        assert result.data is not None
        assert "time" in result.dims

    def test_execute_dim_reduction(self):
        executor, _ = self._setup()
        result = executor.execute("dim_reduction", ["signal"], {"n_components": 2, "method": "pca"})
        assert result.status == "computed"
        assert "component" in result.dims
        assert result.shape[1] == 2

    def test_cache_hit(self):
        executor, _ = self._setup()
        r1 = executor.execute("prewhiten", ["signal"])
        r2 = executor.execute("prewhiten", ["signal"])
        assert r1.cache_key == r2.cache_key
        assert r2 is r1  # same object from cache

    def test_incompatible_input_raises(self):
        executor, _ = self._setup()
        with pytest.raises(ValueError, match="not compatible"):
            executor.execute("bandpower", ["signal"])  # signal has no freq dim

    def test_missing_transform_raises(self):
        executor, _ = self._setup()
        with pytest.raises(KeyError, match="not found"):
            executor.execute("nonexistent", ["signal"])

    def test_missing_tensor_raises(self):
        executor, _ = self._setup()
        with pytest.raises(KeyError, match="not found"):
            executor.execute("prewhiten", ["no_such_tensor"])

    def test_result_registered_in_tensor_registry(self):
        executor, tensor_reg = self._setup()
        result = executor.execute("prewhiten", ["signal"], tensor_id="pw_signal")
        assert "pw_signal" in tensor_reg
        node = tensor_reg.get("pw_signal")
        assert node.transform == "prewhiten"
        assert node.source == "signal"

    def test_custom_tensor_id(self):
        executor, _ = self._setup()
        result = executor.execute("prewhiten", ["signal"], tensor_id="my_custom_id")
        assert result.id == "my_custom_id"

    def test_execute_bandpass(self):
        """Bandpass requires scipy — test when available."""
        executor, _ = self._setup()
        try:
            result = executor.execute("bandpass", ["signal"], {"lo_hz": 1.0, "hi_hz": 40.0})
            assert result.status == "computed"
            assert result.data is not None
        except ImportError:
            pytest.skip("scipy not available")

    def test_execute_psd(self):
        executor, _ = self._setup()
        try:
            result = executor.execute("psd", ["signal"], {"window_s": 0.5})
            assert result.status == "computed"
            assert "freq" in result.dims
        except ImportError:
            pytest.skip("scipy not available")

    def test_execute_spectrogram(self):
        executor, _ = self._setup()
        try:
            result = executor.execute("spectrogram", ["signal"], {"window_s": 0.25, "overlap": 0.5})
            assert result.status == "computed"
            assert "time" in result.dims
            assert "freq" in result.dims
        except ImportError:
            pytest.skip("scipy not available")

    def test_execute_event_align(self):
        executor, _ = self._setup()
        result = executor.execute(
            "event_align", ["signal"],
            {"event_times": [0.5, 1.0], "pre_s": 0.2, "post_s": 0.3},
        )
        assert result.status == "computed"
        assert "event" in result.dims
        assert "time_offset" in result.dims

    def test_execute_coherence(self):
        executor, _ = self._setup()
        try:
            result = executor.execute("coherence", ["signal_flat"], {"window_s": 0.5, "max_pairs": 5})
            assert result.status == "computed"
            assert "pair" in result.dims
            assert "freq" in result.dims
        except ImportError:
            pytest.skip("scipy not available")

    def test_chained_transforms(self):
        """Test transform chaining: signal → bandpass → psd."""
        executor, tensor_reg = self._setup()
        try:
            bp = executor.execute("bandpass", ["signal"], {"lo_hz": 1.0, "hi_hz": 40.0}, tensor_id="bp_signal")
            assert "bp_signal" in tensor_reg
            psd = executor.execute("psd", ["bp_signal"], {"window_s": 0.5}, tensor_id="psd_bp")
            assert psd.status == "computed"
            assert psd.provenance.parent_ids == ("bp_signal",)
            assert "freq" in psd.dims
        except ImportError:
            pytest.skip("scipy not available")

    def test_error_status_on_failure(self):
        """Transform that fails should return error status, not raise."""
        treg = TransformRegistry()
        treg.register(TransformDefinition(
            name="always_fail",
            input_spec=InputSpec(required_dims=("time",)),
            compute=lambda inputs, params: (_ for _ in ()).throw(RuntimeError("boom")),
        ))
        tensor_reg = TensorRegistry()
        tensor_reg.add(_make_grid_tensor("signal"))
        executor = TransformExecutor(treg, tensor_reg)
        result = executor.execute("always_fail", ["signal"])
        assert result.status == "error"
        assert "boom" in result.error


# ---------------------------------------------------------------------------
# TransformDefinition
# ---------------------------------------------------------------------------

class TestTransformDefinition:
    def test_validate_params_fills_defaults(self):
        defn = TransformDefinition(
            name="test",
            input_spec=InputSpec(),
            param_schema={
                "window_s": ParamSpec(dtype="float", default=0.5),
                "order": ParamSpec(dtype="int", default=4),
            },
        )
        validated = defn.validate_params({})
        assert validated == {"window_s": 0.5, "order": 4}

    def test_validate_params_uses_provided(self):
        defn = TransformDefinition(
            name="test",
            input_spec=InputSpec(),
            param_schema={
                "window_s": ParamSpec(dtype="float", default=0.5),
            },
        )
        validated = defn.validate_params({"window_s": 1.0})
        assert validated["window_s"] == 1.0


# ---------------------------------------------------------------------------
# cogpy-backed transforms
# ---------------------------------------------------------------------------

class TestCogpyTransforms:
    """End-to-end exercises of the cogpy-backed compute functions."""

    def _setup(self):
        treg = TransformRegistry()
        register_builtins(treg)
        tensor_reg = TensorRegistry()
        tensor_reg.add(_make_grid_tensor("signal"))
        tensor_reg.add(_make_flat_tensor("signal_flat"))
        executor = TransformExecutor(treg, tensor_reg, TransformCache())
        return executor, tensor_reg

    def test_cmr(self):
        executor, _ = self._setup()
        result = executor.execute("cmr", ["signal"])
        assert result.status == "computed"
        assert result.data.dims == ("time", "AP", "ML")
        # Median over spatial dims should be near zero after CMR.
        med = np.abs(result.data.median(dim=("AP", "ML")).values)
        assert float(med.max()) < 1e-10

    def test_notch(self):
        executor, _ = self._setup()
        result = executor.execute("notch", ["signal"], {"freqs": [10.0, 20.0], "Q": 30.0})
        assert result.status == "computed"
        assert result.data.dims == ("time", "AP", "ML")

    def test_spatial_median(self):
        executor, _ = self._setup()
        result = executor.execute("spatial_median", ["signal"], {"size": 3})
        assert result.status == "computed"
        assert set(result.data.dims) == {"time", "AP", "ML"}

    def test_zscore(self):
        executor, _ = self._setup()
        result = executor.execute("zscore", ["signal"], {"dim": "time", "robust": False})
        assert result.status == "computed"
        # Each channel's z-scored mean ≈ 0, std ≈ 1.
        mean = result.data.mean(dim="time")
        std = result.data.std(dim="time")
        assert float(np.abs(mean.values).max()) < 1e-6
        assert float(np.abs(std.values - 1.0).max()) < 1e-6

    def test_psd_multitaper(self):
        executor, _ = self._setup()
        result = executor.execute(
            "psd_multitaper",
            ["signal"],
            {"NW": 3.0, "fmax": 40.0},
        )
        assert result.status == "computed"
        assert "freq" in result.data.dims
        freq = np.asarray(result.data.coords["freq"].values)
        assert freq.max() <= 40.0 + 1e-6

    def test_psd_welch(self):
        executor, _ = self._setup()
        result = executor.execute(
            "psd_welch",
            ["signal_flat"],
            {"nperseg": 64, "fmax": 30.0},
        )
        assert result.status == "computed"
        assert "freq" in result.data.dims

    def test_restrict_intervals(self):
        executor, tensor_reg = self._setup()
        # signal fixture: fs=100, n_time=200 → t in [0, 1.99)
        result = executor.execute(
            "restrict_intervals",
            ["signal"],
            {"intervals": [[0.0, 0.5], [1.0, 1.5]]},
        )
        assert result.status == "computed"
        t = np.asarray(result.data.coords["time"].values)
        # Every surviving time falls inside one of the two intervals (half-open).
        inside = ((t >= 0.0) & (t < 0.5)) | ((t >= 1.0) & (t < 1.5))
        assert inside.all()
        assert t.size > 0 and t.size < 200

    def test_perievent_epochs_then_triggered_average(self):
        executor, tensor_reg = self._setup()
        epochs = executor.execute(
            "perievent_epochs",
            ["signal"],
            {"event_times": [0.5, 1.0, 1.5], "pre": 0.1, "post": 0.1},
            tensor_id="epochs",
        )
        assert epochs.status == "computed"
        assert "event" in epochs.data.dims
        assert "lag" in epochs.data.dims
        assert epochs.data.sizes["event"] == 3

        eta = executor.execute(
            "triggered_average", ["epochs"], {"event_dim": "event"}
        )
        assert eta.status == "computed"
        assert "event" not in eta.data.dims
        assert "lag" in eta.data.dims

    def test_triggered_std_and_snr(self):
        executor, _ = self._setup()
        executor.execute(
            "perievent_epochs",
            ["signal"],
            {"event_times": [0.3, 0.6, 0.9, 1.2, 1.5], "pre": 0.1, "post": 0.1},
            tensor_id="epochs_many",
        )
        std = executor.execute("triggered_std", ["epochs_many"])
        snr = executor.execute("triggered_snr", ["epochs_many"])
        assert std.status == "computed"
        assert snr.status == "computed"
        assert "event" not in std.data.dims
        assert "event" not in snr.data.dims


class TestCogpyDetectors:
    """Smoke tests for cogpy-backed event detectors."""

    def _signal_with_spike(self, n_time: int = 1000, fs: float = 1000.0) -> xr.DataArray:
        t = np.arange(n_time) / fs
        y = 0.05 * np.random.default_rng(0).standard_normal(n_time)
        # Inject a single large deflection at t=0.5s.
        i = int(0.5 * fs)
        y[i : i + 20] += 10.0
        return xr.DataArray(y, dims=("time",), coords={"time": t}, attrs={"fs": fs})

    def test_registry_contains_cogpy_detectors(self):
        from tensorscope.core.events import list_detectors

        names = {d.name for d in list_detectors()}
        assert {"cogpy_ripple", "cogpy_spindle", "cogpy_burst", "cogpy_threshold"} <= names

    def test_cogpy_threshold_detects(self):
        from tensorscope.core.events import get_detector

        det = get_detector("cogpy_threshold")
        stream = det.detect(
            self._signal_with_spike(),
            {"threshold": 1.0, "direction": "positive", "min_duration": 0.0},
        )
        assert stream.name.startswith("cogpy_thresh")
        assert len(stream) >= 1
