import { describe, it, expect, beforeEach } from "vitest";
import { useDAGStore } from "./dagStore";

const getStore = () => useDAGStore.getState();

beforeEach(() => {
  useDAGStore.setState({ focusedNodeId: null, focusedNodeType: null });
});

describe("setFocusedNode", () => {
  it("sets id and type together", () => {
    getStore().setFocusedNode("lfp", "tensor");
    expect(getStore().focusedNodeId).toBe("lfp");
    expect(getStore().focusedNodeType).toBe("tensor");
  });

  it("defaults type to null when omitted", () => {
    getStore().setFocusedNode("node-1");
    expect(getStore().focusedNodeType).toBeNull();
  });

  it("switching focus replaces both id and type", () => {
    getStore().setFocusedNode("lfp", "tensor");
    getStore().setFocusedNode("bandpass", "transform");
    expect(getStore().focusedNodeId).toBe("bandpass");
    expect(getStore().focusedNodeType).toBe("transform");
  });
});

describe("clearFocus", () => {
  it("resets both fields to null", () => {
    getStore().setFocusedNode("lfp", "tensor");
    getStore().clearFocus();
    expect(getStore().focusedNodeId).toBeNull();
    expect(getStore().focusedNodeType).toBeNull();
  });
});
