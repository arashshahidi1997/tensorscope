/**
 * PipelineTabContent — sidebar tab for executing transforms and managing the DAG.
 *
 * Provides:
 *   1. Transform picker: lists transforms compatible with the selected tensor
 *   2. Parameter form: dynamically generated from the transform's param_schema
 *   3. Execute button: runs the transform and produces a derived tensor
 *   4. Derived tensors list: shows outputs with status badges
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import { useStateQuery } from "../../api/queries";
import { CollapsibleSection } from "./CollapsibleSection";
import type { TransformDefinitionDTO, TransformParamSpec } from "../../types/transform";
import type { DerivedTensorDTO } from "../../types/transform";

export function PipelineTabContent() {
  const selectedTensor = useAppStore((s) => s.selectedTensor);
  const stateQuery = useStateQuery();
  const activeTensor = selectedTensor ?? stateQuery.data?.active_tensor ?? null;

  const [transforms, setTransforms] = useState<TransformDefinitionDTO[]>([]);
  const [selectedTransform, setSelectedTransform] = useState<TransformDefinitionDTO | null>(null);
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [outputId, setOutputId] = useState("");
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DerivedTensorDTO | null>(null);
  const [history, setHistory] = useState<DerivedTensorDTO[]>([]);

  // Fetch compatible transforms when tensor changes
  useEffect(() => {
    if (!activeTensor) {
      setTransforms([]);
      return;
    }
    api.listCompatibleTransforms(activeTensor)
      .then(setTransforms)
      .catch(() => setTransforms([]));
  }, [activeTensor]);

  // Reset form when transform selection changes
  const handleSelectTransform = useCallback((name: string) => {
    const defn = transforms.find((t) => t.name === name) ?? null;
    setSelectedTransform(defn);
    setError(null);
    setResult(null);
    if (defn) {
      // Initialize params from defaults
      const defaults: Record<string, unknown> = {};
      for (const [key, spec] of Object.entries(defn.param_schema)) {
        defaults[key] = spec.default;
      }
      setParams(defaults);
      setOutputId(`${name}_1`);
    } else {
      setParams({});
      setOutputId("");
    }
  }, [transforms]);

  const handleParamChange = useCallback((key: string, value: unknown) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleExecute = useCallback(async () => {
    if (!activeTensor || !selectedTransform) return;
    setExecuting(true);
    setError(null);
    setResult(null);
    try {
      const derived = await api.executeTransform({
        transform_name: selectedTransform.name,
        input_names: [activeTensor],
        params,
        tensor_id: outputId || undefined,
      });
      setResult(derived);
      setHistory((prev) => [derived, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExecuting(false);
    }
  }, [activeTensor, selectedTransform, params, outputId]);

  if (!activeTensor) {
    return <p className="muted">Select a tensor first.</p>;
  }

  return (
    <>
      <CollapsibleSection title="Add Transform" defaultOpen={true}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "4px 0" }}>
          {/* Transform selector */}
          <label style={{ fontSize: 12 }}>
            Transform
            <select
              value={selectedTransform?.name ?? ""}
              onChange={(e) => handleSelectTransform(e.target.value)}
              style={{ display: "block", width: "100%", fontSize: 12, marginTop: 2 }}
            >
              <option value="">-- select --</option>
              {transforms.map((t) => (
                <option key={t.name} value={t.name}>{t.name}</option>
              ))}
            </select>
          </label>

          {selectedTransform && (
            <div style={{ fontSize: 11, color: "#8b949e" }}>
              {selectedTransform.description}
            </div>
          )}

          {/* Input tensor */}
          {selectedTransform && (
            <div style={{ fontSize: 12 }}>
              <span style={{ color: "#8b949e" }}>Input:</span>{" "}
              <span style={{ color: "var(--accent)" }}>{activeTensor}</span>
            </div>
          )}

          {/* Dynamic parameter form */}
          {selectedTransform && Object.keys(selectedTransform.param_schema).length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {Object.entries(selectedTransform.param_schema).map(([key, spec]) => (
                <ParamField
                  key={key}
                  name={key}
                  spec={spec}
                  value={params[key]}
                  onChange={(v) => handleParamChange(key, v)}
                />
              ))}
            </div>
          )}

          {/* Output tensor ID */}
          {selectedTransform && (
            <label style={{ fontSize: 12 }}>
              Output ID
              <input
                type="text"
                value={outputId}
                onChange={(e) => setOutputId(e.target.value)}
                style={{ display: "block", width: "100%", fontSize: 12, marginTop: 2 }}
              />
            </label>
          )}

          {/* Execute button */}
          {selectedTransform && (
            <button
              onClick={handleExecute}
              disabled={executing}
              style={{ fontSize: 12, padding: "4px 12px", cursor: executing ? "wait" : "pointer" }}
            >
              {executing ? "Running..." : "Execute"}
            </button>
          )}

          {/* Result / Error */}
          {error && (
            <div style={{ fontSize: 11, color: "#f85149", whiteSpace: "pre-wrap" }}>
              {error}
            </div>
          )}
          {result && (
            <div style={{ fontSize: 11, color: "#3fb950" }}>
              Created <strong>{result.id}</strong> ({result.dims.join(", ")}) [{result.shape.join(", ")}]
            </div>
          )}
        </div>
      </CollapsibleSection>

      {history.length > 0 && (
        <CollapsibleSection title="Recent Transforms" defaultOpen={true}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "4px 0" }}>
            {history.map((h, i) => (
              <div key={`${h.id}-${i}`} style={{ fontSize: 11, borderBottom: "1px solid #30363d", paddingBottom: 4 }}>
                <div>
                  <span style={{ color: "var(--accent)" }}>{h.id}</span>{" "}
                  <span className={`tensor-badge tensor-badge--${h.status === "error" ? "source" : "derived"}`}>
                    {h.status}
                  </span>
                </div>
                <div style={{ color: "#8b949e" }}>
                  {h.provenance.transform_name}({h.provenance.parent_ids.join(", ")})
                </div>
                {h.error && <div style={{ color: "#f85149" }}>{h.error}</div>}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}
    </>
  );
}

/** A single parameter field, rendered based on the param spec's dtype and constraints. */
function ParamField({
  name,
  spec,
  value,
  onChange,
}: {
  name: string;
  spec: TransformParamSpec;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  // Choices → dropdown
  if (spec.choices && spec.choices.length > 0) {
    return (
      <label style={{ fontSize: 12 }}>
        {name}
        <select
          value={String(value ?? spec.default ?? "")}
          onChange={(e) => onChange(e.target.value)}
          style={{ display: "block", width: "100%", fontSize: 12, marginTop: 2 }}
        >
          {spec.choices.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        {spec.description && <div style={{ fontSize: 10, color: "#8b949e" }}>{spec.description}</div>}
      </label>
    );
  }

  // Boolean → checkbox
  if (spec.dtype === "bool") {
    return (
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
        {name}
        {spec.description && <span style={{ fontSize: 10, color: "#8b949e" }}> — {spec.description}</span>}
      </label>
    );
  }

  // Numeric (int/float)
  if (spec.dtype === "float" || spec.dtype === "int") {
    return (
      <label style={{ fontSize: 12 }}>
        {name}
        <input
          type="number"
          value={value != null ? Number(value) : ""}
          min={spec.min_value ?? undefined}
          max={spec.max_value ?? undefined}
          step={spec.dtype === "int" ? 1 : "any"}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v)) onChange(spec.dtype === "int" ? Math.round(v) : v);
          }}
          style={{ display: "block", width: "100%", fontSize: 12, marginTop: 2 }}
        />
        {spec.description && <div style={{ fontSize: 10, color: "#8b949e" }}>{spec.description}</div>}
      </label>
    );
  }

  // String fallback
  return (
    <label style={{ fontSize: 12 }}>
      {name}
      <input
        type="text"
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        style={{ display: "block", width: "100%", fontSize: 12, marginTop: 2 }}
      />
      {spec.description && <div style={{ fontSize: 10, color: "#8b949e" }}>{spec.description}</div>}
    </label>
  );
}
