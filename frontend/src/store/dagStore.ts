import { create } from "zustand";

/**
 * DAG inspection store.
 *
 * `focusedNodeId` is the only new global state M5 adds.
 * It drives inspector panel content when a DAG node is selected.
 */

type DAGStore = {
  /** Currently focused node id (tensor or transform). Null = no focus. */
  focusedNodeId: string | null;
  /** Type of the focused node, if any. */
  focusedNodeType: "tensor" | "transform" | null;
  /** Set the focused node. */
  setFocusedNode: (nodeId: string | null, nodeType?: "tensor" | "transform" | null) => void;
  /** Clear focus. */
  clearFocus: () => void;
};

export const useDAGStore = create<DAGStore>((set) => ({
  focusedNodeId: null,
  focusedNodeType: null,
  setFocusedNode: (nodeId, nodeType = null) =>
    set({ focusedNodeId: nodeId, focusedNodeType: nodeType }),
  clearFocus: () => set({ focusedNodeId: null, focusedNodeType: null }),
}));
