// @vitest-environment jsdom
/**
 * Smoke coverage for the keyboard shortcut → store contract.
 *
 * The hook itself can't be exercised without React mounting, so the
 * tests here only assert on the *effect* of the contract: given a
 * keydown on `window`, the store changes (or doesn't, when guarded).
 *
 * The actual `useEffect` plumbing — listener add/remove on (re)mount —
 * is implicit and we trust react-testing-library wouldn't catch
 * regressions there either without a real mount. If a hard bug surfaces
 * we'll add a renderHook test.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { decisionKey, useEventReviewStore } from "../../store/eventReviewStore";
import { useEventReviewShortcuts } from "./useEventReviewShortcuts";

function dispatchKey(key: string, target?: HTMLElement): void {
  const ev = new KeyboardEvent("keydown", { key, bubbles: true });
  if (target) {
    Object.defineProperty(ev, "target", { value: target, configurable: true });
    target.dispatchEvent(ev);
  } else {
    window.dispatchEvent(ev);
  }
}

describe("useEventReviewShortcuts", () => {
  beforeEach(() => {
    useEventReviewStore.setState({ decisions: {} });
  });
  afterEach(() => {
    // Tear down hooks so their effect cleanup runs and the window listener
    // they installed gets detached. Without this each test's listener piles
    // up on `window` and stale closures fire on later tests' keydowns.
    cleanup();
    document.body.innerHTML = "";
  });

  it("fires y → accepted on the current event", () => {
    let prev = 0, next = 0;
    renderHook(() =>
      useEventReviewShortcuts({
        tensorName: "lfp",
        streamName: "spindles",
        currentEventId: 7,
        goPrev: () => { prev++; },
        goNext: () => { next++; },
      }),
    );
    dispatchKey("y");
    const d = useEventReviewStore.getState().decisions[decisionKey("lfp", "spindles", 7)];
    expect(d?.status).toBe("accepted");
    expect(prev).toBe(0);
    expect(next).toBe(0);
  });

  it("fires j → goNext, k → goPrev", () => {
    let prev = 0, next = 0;
    renderHook(() =>
      useEventReviewShortcuts({
        tensorName: "lfp",
        streamName: "spindles",
        currentEventId: 1,
        goPrev: () => { prev++; },
        goNext: () => { next++; },
      }),
    );
    dispatchKey("j");
    dispatchKey("k");
    dispatchKey("j");
    expect(next).toBe(2);
    expect(prev).toBe(1);
  });

  it("u clears an existing decision", () => {
    useEventReviewStore.getState().setDecision(
      decisionKey("lfp", "spindles", 7),
      "accepted",
    );
    renderHook(() =>
      useEventReviewShortcuts({
        tensorName: "lfp",
        streamName: "spindles",
        currentEventId: 7,
        goPrev: () => {},
        goNext: () => {},
      }),
    );
    dispatchKey("u");
    expect(useEventReviewStore.getState().decisions[decisionKey("lfp", "spindles", 7)]).toBeUndefined();
  });

  it("no-ops when focus is in an input", () => {
    renderHook(() =>
      useEventReviewShortcuts({
        tensorName: "lfp",
        streamName: "spindles",
        currentEventId: 1,
        goPrev: () => {},
        goNext: () => {},
      }),
    );
    const input = document.createElement("input");
    document.body.appendChild(input);
    dispatchKey("y", input);
    expect(Object.keys(useEventReviewStore.getState().decisions)).toHaveLength(0);
  });

  it("no-ops when no event is active (decision keys only)", () => {
    let next = 0;
    renderHook(() =>
      useEventReviewShortcuts({
        tensorName: "lfp",
        streamName: "spindles",
        currentEventId: null,
        goPrev: () => {},
        goNext: () => { next++; },
      }),
    );
    dispatchKey("y");
    dispatchKey("j");
    expect(Object.keys(useEventReviewStore.getState().decisions)).toHaveLength(0);
    // j (navigation) still works without a selected event
    expect(next).toBe(1);
  });

  it("ignores keys with modifier held", () => {
    renderHook(() =>
      useEventReviewShortcuts({
        tensorName: "lfp",
        streamName: "spindles",
        currentEventId: 1,
        goPrev: () => {},
        goNext: () => {},
      }),
    );
    const ev = new KeyboardEvent("keydown", { key: "y", ctrlKey: true });
    window.dispatchEvent(ev);
    expect(Object.keys(useEventReviewStore.getState().decisions)).toHaveLength(0);
  });
});
