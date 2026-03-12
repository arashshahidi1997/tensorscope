/**
 * DAGGraphView — lightweight SVG visualization of the workspace transform DAG.
 *
 * Renders tensor and transform nodes as a top-down layered graph.
 * Tensor nodes are clickable (sets active tensor), and hoverable (shows tooltip).
 */
import { useCallback, useMemo, useState } from "react";
import { useDAGQuery } from "../../api/queries";
import { useAppStore } from "../../store/appStore";
import type {
  DAGTensorNodeDTO,
  DAGTransformNodeDTO,
  TransformEdgeDTO,
  WorkspaceDAGDTO,
} from "../../types/dag";

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const NODE_W = 140;
const NODE_H = 40;
const TRANSFORM_W = 120;
const TRANSFORM_H = 32;
const LAYER_GAP_Y = 72;
const NODE_GAP_X = 24;
const PAD_X = 20;
const PAD_Y = 20;
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

function computeLayout(dag: WorkspaceDAGDTO) {
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
      const totalWidth = count * w + (count - 1) * NODE_GAP_X;
      const startX = PAD_X + (count > 1 ? i * (w + NODE_GAP_X) : 0);
      // Center the layer
      const offsetX = count > 1 ? 0 : 0;
      const x = startX + offsetX;
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
  onHover,
  onLeave,
  onClick,
}: {
  node: LayoutNode;
  isActive: boolean;
  onHover: (info: TooltipInfo) => void;
  onLeave: () => void;
  onClick: () => void;
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
      />
      <text
        x={node.w / 2}
        y={node.h / 2 + 1}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={11}
        fontWeight={500}
        fill="var(--text)"
      >
        {truncate(d.display_name, 16)}
      </text>
    </g>
  );
}

function TransformNodeRect({
  node,
  onHover,
  onLeave,
}: {
  node: LayoutNode;
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
        rx={4}
        ry={4}
      />
      <text
        x={node.w / 2}
        y={node.h / 2 + 1}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={10}
        fill="var(--text)"
      >
        {truncate(d.transform_name, 14)}
      </text>
    </g>
  );
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen - 1) + "\u2026" : s;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DAGGraphView() {
  const dagQuery = useDAGQuery();
  const selectedTensor = useAppStore((s) => s.selectedTensor);
  const setSelectedTensor = useAppStore((s) => s.setSelectedTensor);
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);

  const handleHover = useCallback((info: TooltipInfo) => setTooltip(info), []);
  const handleLeave = useCallback(() => setTooltip(null), []);

  const layout = useMemo(() => {
    if (!dagQuery.data) return null;
    return computeLayout(dagQuery.data);
  }, [dagQuery.data]);

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

  return (
    <div className="dag-graph">
      <svg
        width={layout.svgW}
        height={layout.svgH}
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
              onHover={handleHover}
              onLeave={handleLeave}
              onClick={() =>
                setSelectedTensor(
                  (node.data as DAGTensorNodeDTO).tensor_id,
                )
              }
            />
          ) : (
            <TransformNodeRect
              key={node.id}
              node={node}
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
    </div>
  );
}
