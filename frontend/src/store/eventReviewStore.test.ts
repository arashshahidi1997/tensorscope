// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  countReviewedInScope,
  decisionKey,
  decisionsInScope,
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

  it("updateTags round-trips and preserves notes/status", () => {
    const k = decisionKey("lfp", "spindles", 1);
    const { setDecision, updateNotes, updateTags } = useEventReviewStore.getState();
    setDecision(k, "accepted");
    updateNotes(k, "methods-figure candidate");
    updateTags(k, ["methods", "candidate"]);
    const d = useEventReviewStore.getState().decisions[k];
    expect(d.status).toBe("accepted");
    expect(d.notes).toBe("methods-figure candidate");
    expect(d.tags).toEqual(["methods", "candidate"]);

    // Overwriting tags replaces the list entirely (no merge).
    useEventReviewStore.getState().updateTags(k, ["artifact"]);
    const d2 = useEventReviewStore.getState().decisions[k];
    expect(d2.tags).toEqual(["artifact"]);
    expect(d2.notes).toBe("methods-figure candidate");
    expect(d2.status).toBe("accepted");
  });

  it("updateTags is a no-op without an existing decision", () => {
    const k = decisionKey("lfp", "spindles", 1);
    useEventReviewStore.getState().updateTags(k, ["should-not-persist"]);
    expect(useEventReviewStore.getState().decisions[k]).toBeUndefined();
  });

  it("setDecision after updateTags keeps existing tags", () => {
    const k = decisionKey("lfp", "spindles", 1);
    const s = useEventReviewStore.getState();
    s.setDecision(k, "maybe");
    s.updateTags(k, ["candidate"]);
    s.setDecision(k, "accepted");
    expect(useEventReviewStore.getState().decisions[k].tags).toEqual(["candidate"]);
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

  it("decisionsInScope enumerates only the matching (tensor, stream)", () => {
    const s = useEventReviewStore.getState();
    s.setDecision(decisionKey("lfp", "spindles", 1), "accepted");
    s.setDecision(decisionKey("lfp", "spindles", "ev-2"), "rejected");
    s.setDecision(decisionKey("lfp", "ripples", 1), "accepted");
    const got = decisionsInScope(
      useEventReviewStore.getState().decisions,
      "lfp",
      "spindles",
    );
    expect(got.map((e) => e.eventId).sort()).toEqual(["1", "ev-2"]);
    expect(got.every((e) => e.decision.status !== undefined)).toBe(true);
  });

  it("replaceScope swaps in a fresh set of decisions and leaves siblings alone", () => {
    const s = useEventReviewStore.getState();
    // Pre-existing local edits the user has been making.
    s.setDecision(decisionKey("lfp", "spindles", 1), "accepted");
    s.setDecision(decisionKey("lfp", "spindles", 2), "rejected");
    // Sibling scope that must not be touched.
    s.setDecision(decisionKey("lfp", "ripples", 1), "maybe");

    useEventReviewStore.getState().replaceScope("lfp", "spindles", [
      {
        eventId: 10,
        decision: { status: "accepted", decidedAt: 12345, tags: ["from-disk"] },
      },
      {
        eventId: "ev-x",
        decision: {
          status: "maybe",
          decidedAt: 99999,
          notes: "rehydrated",
          tags: [],
        },
      },
    ]);

    const d = useEventReviewStore.getState().decisions;
    // Old (lfp, spindles) decisions are gone.
    expect(d[decisionKey("lfp", "spindles", 1)]).toBeUndefined();
    expect(d[decisionKey("lfp", "spindles", 2)]).toBeUndefined();
    // New ones are present.
    expect(d[decisionKey("lfp", "spindles", 10)].tags).toEqual(["from-disk"]);
    expect(d[decisionKey("lfp", "spindles", "ev-x")].notes).toBe("rehydrated");
    // Sibling scope is untouched.
    expect(d[decisionKey("lfp", "ripples", 1)].status).toBe("maybe");
  });
});
