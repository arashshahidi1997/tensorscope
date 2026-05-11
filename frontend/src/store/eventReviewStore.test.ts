// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  countReviewedInScope,
  decisionKey,
  useEventReviewStore,
} from "./eventReviewStore";

function resetStore(): void {
  // Persist middleware shares the `decisions` slot across tests; clear it.
  useEventReviewStore.setState({ decisions: {} });
}

describe("eventReviewStore", () => {
  beforeEach(() => {
    resetStore();
    window.localStorage?.removeItem?.("tensorscope:event-review");
  });

  it("decisionKey is stable and reversible by parse", () => {
    expect(decisionKey("lfp", "spindles", 42)).toBe("lfp|spindles|42");
    expect(decisionKey("lfp", "spindles", "ev-42")).toBe("lfp|spindles|ev-42");
  });

  it("setDecision records status and decidedAt", () => {
    const k = decisionKey("lfp", "spindles", 1);
    useEventReviewStore.getState().setDecision(k, "accepted");
    const d = useEventReviewStore.getState().decisions[k];
    expect(d.status).toBe("accepted");
    expect(typeof d.decidedAt).toBe("number");
    expect(d.decidedAt).toBeGreaterThan(0);
  });

  it("setDecision overwrites status but keeps existing notes", () => {
    const k = decisionKey("lfp", "spindles", 1);
    const { setDecision, updateNotes } = useEventReviewStore.getState();
    setDecision(k, "maybe");
    updateNotes(k, "looks like an artifact");
    setDecision(k, "rejected");
    const d = useEventReviewStore.getState().decisions[k];
    expect(d.status).toBe("rejected");
    expect(d.notes).toBe("looks like an artifact");
  });

  it("clearDecision removes the entry", () => {
    const k = decisionKey("lfp", "spindles", 1);
    useEventReviewStore.getState().setDecision(k, "accepted");
    useEventReviewStore.getState().clearDecision(k);
    expect(useEventReviewStore.getState().decisions[k]).toBeUndefined();
  });

  it("updateNotes is a no-op without an existing decision", () => {
    const k = decisionKey("lfp", "spindles", 1);
    useEventReviewStore.getState().updateNotes(k, "should not persist");
    expect(useEventReviewStore.getState().decisions[k]).toBeUndefined();
  });

  it("clearScope drops only the matching tensor+stream", () => {
    const s = useEventReviewStore.getState();
    s.setDecision(decisionKey("lfp", "spindles", 1), "accepted");
    s.setDecision(decisionKey("lfp", "spindles", 2), "rejected");
    s.setDecision(decisionKey("lfp", "ripples", 1), "accepted");
    s.setDecision(decisionKey("ecg", "spindles", 1), "accepted");
    useEventReviewStore.getState().clearScope("lfp", "spindles");
    const d = useEventReviewStore.getState().decisions;
    expect(d[decisionKey("lfp", "spindles", 1)]).toBeUndefined();
    expect(d[decisionKey("lfp", "spindles", 2)]).toBeUndefined();
    expect(d[decisionKey("lfp", "ripples", 1)]).toBeDefined();
    expect(d[decisionKey("ecg", "spindles", 1)]).toBeDefined();
  });

  it("countReviewedInScope counts only decided IDs in the right scope", () => {
    const s = useEventReviewStore.getState();
    s.setDecision(decisionKey("lfp", "spindles", 1), "accepted");
    s.setDecision(decisionKey("lfp", "spindles", 3), "rejected");
    s.setDecision(decisionKey("lfp", "ripples", 2), "accepted");
    const got = countReviewedInScope(
      useEventReviewStore.getState().decisions,
      "lfp",
      "spindles",
      [1, 2, 3, 4],
    );
    expect(got).toEqual({ reviewed: 2, total: 4 });
  });
});
