/**
 * DAGGraphView — lightweight SVG visualization of the workspace transform DAG.
 *
 * Renders tensor and transform nodes as a top-down layered graph.
 * Tensor nodes are clickable (sets active tensor), and hoverable (shows tooltip).
 * Supports fullscreen mode with "add transform" buttons on tensor nodes.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useDAGQuery } from "../../api/queries";
import { useAppStore } from "../../store/appStore";
import type {
  DAGTensorNodeDTO,
  DAGTransformNodeDTO,
  WorkspaceDAGDTO,
} from "../../types/dag";
import type {
  TransformDefinitionDTO,
  TransformParamSpec,
} from "../../types/transform";

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const NORMAL = {
  NODE_W: 140,
  NODE_H: 40,
  TRANSFORM_W: 120,
  TRANSFORM_H: 32,
  LAYER_GAP_Y: 72,
  NODE_GAP_X: 24,
  PAD_X: 20,
  PAD_Y: 20,
  FONT_NODE: 11,
  FONT_TRANSFORM: 10,
  TRUNCATE_NODE: 16,
  TRUNCATE_TRANSFORM: 14,
};

const FULLSCREEN = {
  NODE_W: 200,
  NODE_H: 52,
  TRANSFORM_W: 160,
  TRANSFORM_H: 40,
  LAYER_GAP_Y: 100,
  NODE_GAP_X: 40,
  PAD_X: 40,
  PAD_Y: 40,
  FONT_NODE: 13,
  FONT_TRANSFORM: 12,
  TRUNCATE_NODE: 22,
  TRUNCATE_TRANSFORM: 18,
};

const ARROW_SIZE = 5;

// ---------------------------------------------------------------------------
// Layout computation
// ---------------------------------------------------------------------------

type LayoutNode = {
  id: string;
  kind: "tensor" | "transform";
  layer: number;
  x: number;
  y: number;
  w: number;
  h: number;
  data: DAGTensorNodeDTO | DAGTransformNodeDTO;
};

type LayoutEdge = {
  from: LayoutNode;
  to: LayoutNode;
};

type LayoutSizes = typeof NORMAL;

function computeLayout(dag: WorkspaceDAGDTO, sizes: LayoutSizes) {
  const { NODE_W, NODE_H, TRANSFORM_W, TRANSFORM_H, LAYER_GAP_Y, NODE_GAP_X, PAD_X, PAD_Y } = sizes;
  const allIds = new Set<string>();
  const children = new Map<string, string[]>();
  const parents = new Map<string, string[]>();

  // Build adjacency from edges
  for (const tn of dag.tensor_nodes) allIds.add(tn.id);
  for (const tn of dag.transform_nodes) allIds.add(tn.id);

  for (const id of allIds) {
    children.set(id, []);
    parents.set(id, []);
  }

  for (const e of dag.edges) {
    children.get(e.source_id)?.push(e.target_id);
    parents.get(e.target_id)?.push(e.source_id);
  }

  // Assign layers by longest path from root (BFS-based topological depth)
  const depth = new Map<string, number>();
  const roots = [...allIds].filter((id) => (parents.get(id)?.length ?? 0) === 0);

  // Initialize all to 0
  for (const id of allIds) depth.set(id, 0);

  // BFS forward pass: depth = max(parent depths) + 1
  const queue = [...roots];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const d = depth.get(id) ?? 0;
    for (const child of children.get(id) ?? []) {
      const current = depth.get(child) ?? 0;
      depth.set(child, Math.max(current, d + 1));
      queue.push(child);
    }
  }

  // Group nodes by layer
  const layerMap = new Map<number, string[]>();
  for (const id of allIds) {
    const d = depth.get(id) ?? 0;
    if (!layerMap.has(d)) layerMap.set(d, []);
    layerMap.get(d)!.push(id);
  }

  const maxLayer = Math.max(...layerMap.keys(), 0);

  // Index nodes by id
  const tensorMap = new Map<string, DAGTensorNodeDTO>();
  const transformMap = new Map<string, DAGTransformNodeDTO>();
  for (const n of dag.tensor_nodes) tensorMap.set(n.id, n);
  for (const n of dag.transform_nodes) transformMap.set(n.id, n);

  // Assign positions
  const nodes: LayoutNode[] = [];
  const nodeById = new Map<string, LayoutNode>();

  for (let layer = 0; layer <= maxLayer; layer++) {
    const ids = layerMap.get(layer) ?? [];
    const count = ids.length;
    for (let i = 0; i < count; i++) {
      const id = ids[i];
      const isTensor = tensorMap.has(id);
      const w = isTensor ? NODE_W : TRANSFORM_W;
      const h = isTensor ? NODE_H : TRANSFORM_H;
      const startX = PAD_X + (count > 1 ? i * (w + NODE_GAP_X) : 0);
      const x = startX;
      const y = PAD_Y + layer * LAYER_GAP_Y;

      const data = isTensor ? tensorMap.get(id)! : transformMap.get(id)!;
      const node: LayoutNode = { id, kind: isTensor ? "tensor" : "transform", layer, x, y, w, h, data };
      nodes.push(node);
      nodeById.set(id, node);
    }
  }

  // Center layers relative to widest layer
  const layerWidths = new Map<number, number>();
  for (let layer = 0; layer <= maxLayer; layer++) {
    const ids = layerMap.get(layer) ?? [];
    const count = ids.length;
    if (count === 0) continue;
    const firstNode = nodeById.get(ids[0]);
    const lastNode = nodeById.get(ids[count - 1]);
    if (firstNode && lastNode) {
      layerWidths.set(layer, lastNode.x + lastNode.w - firstNode.x);
    }
  }
  const maxWidth = Math.max(...layerWidths.values(), 0);

  for (let layer = 0; layer <= maxLayer; layer++) {
    const ids = layerMap.get(layer) ?? [];
    const w = layerWidths.get(layer) ?? 0;
    const offset = (maxWidth - w) / 2;
    for (const id of ids) {
      const n = nodeById.get(id);
      if (n) n.x += offset;
    }
  }

  // Build edges
  const edges: LayoutEdge[] = [];
  for (const e of dag.edges) {
    const from = nodeById.get(e.source_id);
    const to = nodeById.get(e.target_id);
    if (from && to) edges.push({ from, to });
  }

  const svgW = maxWidth + PAD_X * 2;
  const svgH = (maxLayer + 1) * LAYER_GAP_Y + PAD_Y;

  return { nodes, edges, svgW: Math.max(svgW, 200), svgH: Math.max(svgH, 100) };
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

type TooltipInfo = {
  x: number;
  y: number;
  node: LayoutNode;
};

function formatTooltip(node: LayoutNode): string {
  if (node.kind === "tensor") {
    const d = node.data as DAGTensorNodeDTO;
    const parts = [
      `Tensor: ${d.tensor_id}`,
      `Type: ${d.node_type}`,
      `Visible: ${d.visible}`,
    ];
    if (d.exploratory) parts.push("Exploratory");
    if (d.pipeline_selected) parts.push("Pipeline selected");
    return parts.join("\n");
  }
  const d = node.data as DAGTransformNodeDTO;
  const parts = [
    `Transform: ${d.transform_name}`,
    `Status: ${d.status}`,
  ];
  if (d.error) parts.push(`Error: ${d.error}`);
  const paramStr = Object.entries(d.params)
    .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
    .join("\n");
  if (paramStr) parts.push(`Params:\n${paramStr}`);
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// SVG sub-components
// ---------------------------------------------------------------------------

function EdgePath({ edge }: { edge: LayoutEdge }) {
  const { from, to } = edge;
  const x1 = from.x + from.w / 2;
  const y1 = from.y + from.h;
  const x2 = to.x + to.w / 2;
  const y2 = to.y;
  const midY = (y1 + y2) / 2;

  return (
    <g className="dag-edge">
      <path
        d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
        fill="none"
        stroke="var(--muted)"
        strokeWidth={1.5}
        opacity={0.5}
      />
      {/* Arrowhead */}
      <polygon
        points={`${x2},${y2} ${x2 - ARROW_SIZE},${y2 - ARROW_SIZE * 1.5} ${x2 + ARROW_SIZE},${y2 - ARROW_SIZE * 1.5}`}
        fill="var(--muted)"
        opacity={0.5}
      />
    </g>
  );
}

function TensorNodeRect({
  node,
  isActive,
  isFullscreen,
  sizes,
  onHover,
  onLeave,
  onClick,
  onAddClick,
}: {
  node: LayoutNode;
  isActive: boolean;
  isFullscreen: boolean;
  sizes: LayoutSizes;
  onHover: (info: TooltipInfo) => void;
  onLeave: () => void;
  onClick: () => void;
  onAddClick?: (node: LayoutNode) => void;
}) {
  const d = node.data as DAGTensorNodeDTO;
  const isSource = d.node_type === "source";

  const className = [
    "dag-node",
    isSource ? "dag-node--source" : "dag-node--derived",
    isActive ? "dag-node--active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <g
      className={className}
      transform={`translate(${node.x}, ${node.y})`}
      onMouseEnter={(e) =>
        onHover({ x: e.clientX, y: e.clientY, node })
      }
      onMouseLeave={onLeave}
      onClick={onClick}
      style={{ cursor: "pointer" }}
    >
      <rect
        width={node.w}
        height={node.h}
        rx={6}
        ry={6}
        strokeDasharray={isSource ? undefined : "6 3"}
      />
      <text
        x={node.w / 2}
        y={node.h / 2 + 1}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={sizes.FONT_NODE}
        fontWeight={500}
        fill="var(--text)"
      >
        {truncate(d.display_name, sizes.TRUNCATE_NODE)}
      </text>
      {/* "+" button — only in fullscreen mode */}
      {isFullscreen && onAddClick && (
        <g
          className="dag-node-add-btn"
          transform={`translate(${node.w - 14}, ${node.h - 14})`}
          onClick={(e) => {
            e.stopPropagation();
            onAddClick(node);
          }}
        >
          <circle cx={8} cy={8} r={10} />
          <text
            x={8}
            y={9}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={14}
            fontWeight={700}
            fill="var(--text)"
          >
            +
          </text>
        </g>
      )}
    </g>
  );
}

function TransformNodeRect({
  node,
  sizes,
  onHover,
  onLeave,
}: {
  node: LayoutNode;
  sizes: LayoutSizes;
  onHover: (info: TooltipInfo) => void;
  onLeave: () => void;
}) {
  const d = node.data as DAGTransformNodeDTO;
  return (
    <g
      className="dag-node dag-node--transform"
      transform={`translate(${node.x}, ${node.y})`}
      onMouseEnter={(e) =>
        onHover({ x: e.clientX, y: e.clientY, node })
      }
      onMouseLeave={onLeave}
    >
      <rect
        width={node.w}
        height={node.h}
        rx={12}
        ry={12}
      />
      <text
        x={node.w / 2}
        y={node.h / 2 + 1}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={sizes.FONT_TRANSFORM}
        fill="var(--text)"
      >
        {truncate(d.transform_name, sizes.TRUNCATE_TRANSFORM)}
      </text>
    </g>
  );
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen - 1) + "\u2026" : s;
}

// ---------------------------------------------------------------------------
// AddTransformPicker — inline form for adding transforms from a tensor node
// ---------------------------------------------------------------------------

function AddTransformPicker({
  tensorId,
  anchorX,
  anchorY,
  onClose,
  onExecuted,
}: {
  tensorId: string;
  anchorX: number;
  anchorY: number;
  onClose: () => void;
  onExecuted: () => void;
}) {
  const [transforms, setTransforms] = useState<TransformDefinitionDTO[]>([]);
  const [selectedTransform, setSelectedTransform] = useState<TransformDefinitionDTO | null>(null);
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [outputId, setOutputId] = useState("");
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listCompatibleTransforms(tensorId)
      .then(setTransforms)
      .catch(() => setTransforms([]));
  }, [tensorId]);

  const handleSelectTransform = useCallback((name: string) => {
    const defn = transforms.find((t) => t.name === name) ?? null;
    setSelectedTransform(defn);
    setError(null);
    if (defn) {
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
    if (!selectedTransform) return;
    setExecuting(true);
    setError(null);
    try {
      await api.executeTransform({
        transform_name: selectedTransform.name,
        input_names: [tensorId],
        params,
        tensor_id: outputId || undefined,
      });
      onExecuted();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExecuting(false);
    }
  }, [selectedTransform, tensorId, params, outputId, onExecuted, onClose]);

  return (
    <div
      className="dag-transform-picker"
      style={{ left: anchorX, top: anchorY }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <strong style={{ fontSize: 12 }}>Add Transform</strong>
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--muted)",
            cursor: "pointer",
            fontSize: 14,
            padding: "0 2px",
          }}
        >
          x
        </button>
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>
        Input: <span style={{ color: "var(--accent)" }}>{tensorId}</span>
      </div>
      <label style={{ fontSize: 12, display: "block", marginBottom: 6 }}>
        Transform
        <select
          value={selectedTransform?.name ?? ""}
          onChange={(e) => handleSelectTransform(e.target.value)}
          style={{ display: "block", width: "100%", fontSize: 12, marginTop: 2, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 4px" }}
        >
          <option value="">-- select --</option>
          {transforms.map((t) => (
            <option key={t.name} value={t.name}>{t.name}</option>
          ))}
        </select>
      </label>

      {selectedTransform && selectedTransform.description && (
        <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 6 }}>
          {selectedTransform.description}
        </div>
      )}

      {selectedTransform && Object.keys(selectedTransform.param_schema).length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 }}>
          {Object.entries(selectedTransform.param_schema).map(([key, spec]) => (
            <PickerParamField
              key={key}
              name={key}
              spec={spec}
              value={params[key]}
              onChange={(v) => handleParamChange(key, v)}
            />
          ))}
        </div>
      )}

      {selectedTransform && (
        <label style={{ fontSize: 12, display: "block", marginBottom: 6 }}>
          Output ID
          <input
            type="text"
            value={outputId}
            onChange={(e) => setOutputId(e.target.value)}
            style={{ display: "block", width: "100%", fontSize: 12, marginTop: 2, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 4px" }}
          />
        </label>
      )}

      {selectedTransform && (
        <button
          className="action-button"
          onClick={handleExecute}
          disabled={executing}
          style={{ fontSize: 12, padding: "4px 12px", marginTop: 0 }}
        >
          {executing ? "Running..." : "Execute"}
        </button>
      )}

      {error && (
        <div style={{ fontSize: 11, color: "var(--alert)", whiteSpace: "pre-wrap", marginTop: 4 }}>
          {error}
        </div>
      )}
    </div>
  );
}

/** A single parameter field for the transform picker. */
function PickerParamField({
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
  const inputStyle = {
    display: "block" as const,
    width: "100%",
    fontSize: 12,
    marginTop: 2,
    background: "var(--bg)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "2px 4px",
  };

  if (spec.choices && spec.choices.length > 0) {
    return (
      <label style={{ fontSize: 11 }}>
        {name}
        <select
          value={String(value ?? spec.default ?? "")}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
        >
          {spec.choices.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </label>
    );
  }

  if (spec.dtype === "bool") {
    return (
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
        {name}
      </label>
    );
  }

  if (spec.dtype === "float" || spec.dtype === "int") {
    const strVal = value != null ? String(value) : "";
    return (
      <label style={{ fontSize: 11 }}>
        {name}
        <input
          type="text"
          inputMode="decimal"
          value={strVal}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "" || raw === "-") {
              onChange(raw === "-" ? raw : null);
              return;
            }
            const v = parseFloat(raw);
            if (Number.isFinite(v)) {
              onChange(spec.dtype === "int" ? Math.round(v) : v);
            }
          }}
          style={inputStyle}
        />
      </label>
    );
  }

  return (
    <label style={{ fontSize: 11 }}>
      {name}
      <input
        type="text"
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type DAGGraphViewProps = {
  isFullscreen?: boolean;
};

export function DAGGraphView({ isFullscreen = false }: DAGGraphViewProps) {
  const dagQuery = useDAGQuery();
  const queryClient = useQueryClient();
  const selectedTensor = useAppStore((s) => s.selectedTensor);
  const setSelectedTensor = useAppStore((s) => s.setSelectedTensor);
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);
  const [pickerNode, setPickerNode] = useState<LayoutNode | null>(null);

  const handleHover = useCallback((info: TooltipInfo) => setTooltip(info), []);
  const handleLeave = useCallback(() => setTooltip(null), []);

  const handleAddClick = useCallback((node: LayoutNode) => {
    setPickerNode(node);
  }, []);

  const handlePickerClose = useCallback(() => {
    setPickerNode(null);
  }, []);

  const handleTransformExecuted = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["dag"] });
  }, [queryClient]);

  const sizes = isFullscreen ? FULLSCREEN : NORMAL;

  const layout = useMemo(() => {
    if (!dagQuery.data) return null;
    return computeLayout(dagQuery.data, sizes);
  }, [dagQuery.data, sizes]);

  if (dagQuery.isLoading) {
    return (
      <div className="panel">
        <p className="muted">Loading DAG...</p>
      </div>
    );
  }

  if (dagQuery.isError) {
    return (
      <div className="panel">
        <p className="muted">Failed to load DAG</p>
      </div>
    );
  }

  if (!layout || layout.nodes.length === 0) {
    return (
      <div className="panel">
        <p className="muted">No transform graph yet</p>
      </div>
    );
  }

  // Compute picker anchor position relative to SVG container
  const pickerTensorId = pickerNode
    ? (pickerNode.data as DAGTensorNodeDTO).tensor_id
    : null;
  const pickerAnchorX = pickerNode ? pickerNode.x + pickerNode.w + 8 : 0;
  const pickerAnchorY = pickerNode ? pickerNode.y : 0;

  return (
    <div className={isFullscreen ? "dag-graph dag-graph--fullscreen" : "dag-graph"} style={{ position: "relative" }}>
      <svg
        width={isFullscreen ? "100%" : layout.svgW}
        height={isFullscreen ? "100%" : layout.svgH}
        viewBox={`0 0 ${layout.svgW} ${layout.svgH}`}
        style={{ display: "block", maxWidth: "100%" }}
      >
        {/* Edges first (behind nodes) */}
        {layout.edges.map((e, i) => (
          <EdgePath key={i} edge={e} />
        ))}
        {/* Nodes */}
        {layout.nodes.map((node) =>
          node.kind === "tensor" ? (
            <TensorNodeRect
              key={node.id}
              node={node}
              isActive={
                (node.data as DAGTensorNodeDTO).tensor_id === selectedTensor
              }
              isFullscreen={isFullscreen}
              sizes={sizes}
              onHover={handleHover}
              onLeave={handleLeave}
              onClick={() =>
                setSelectedTensor(
                  (node.data as DAGTensorNodeDTO).tensor_id,
                )
              }
              onAddClick={handleAddClick}
            />
          ) : (
            <TransformNodeRect
              key={node.id}
              node={node}
              sizes={sizes}
              onHover={handleHover}
              onLeave={handleLeave}
            />
          ),
        )}
      </svg>
      {tooltip && (
        <div
          className="dag-tooltip"
          style={{
            position: "fixed",
            left: tooltip.x + 12,
            top: tooltip.y + 12,
            zIndex: 999,
          }}
        >
          {formatTooltip(tooltip.node)}
        </div>
      )}
      {pickerNode && pickerTensorId && (
        <AddTransformPicker
          tensorId={pickerTensorId}
          anchorX={pickerAnchorX}
          anchorY={pickerAnchorY}
          onClose={handlePickerClose}
          onExecuted={handleTransformExecuted}
        />
      )}
    </div>
  );
}
