// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { useAppStore } from "../../store/appStore";
import { useChannelViewportShortcuts } from "./useChannelViewportShortcuts";

function dispatchKey(key: string, opts: { shiftKey?: boolean } = {}, target?: HTMLElement): void {
  const ev = new KeyboardEvent("keydown", { key, ...opts });
  if (target) {
    Object.defineProperty(ev, "target", { value: target, configurable: true });
    target.dispatchEvent(ev);
  } else {
    window.dispatchEvent(ev);
  }
}

describe("useChannelViewportShortcuts", () => {
  beforeEach(() => {
    useAppStore.setState({ tsFirstChannel: 0 });
  });
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("] scrolls down by quarter window (step=8 for nVisible=32)", () => {
    renderHook(() =>
      useChannelViewportShortcuts({ totalChannels: 256, nVisible: 32 }),
    );
    dispatchKey("]");
    expect(useAppStore.getState().tsFirstChannel).toBe(8);
    dispatchKey("]");
    expect(useAppStore.getState().tsFirstChannel).toBe(16);
  });

  it("[ scrolls up; clamps at 0", () => {
    useAppStore.setState({ tsFirstChannel: 4 });
    renderHook(() =>
      useChannelViewportShortcuts({ totalChannels: 256, nVisible: 32 }),
    );
    dispatchKey("[");
    expect(useAppStore.getState().tsFirstChannel).toBe(0);
    dispatchKey("[");
    expect(useAppStore.getState().tsFirstChannel).toBe(0); // clamped
  });

  it("Shift+] pages by full window", () => {
    renderHook(() =>
      useChannelViewportShortcuts({ totalChannels: 256, nVisible: 32 }),
    );
    dispatchKey("]", { shiftKey: true });
    expect(useAppStore.getState().tsFirstChannel).toBe(32);
  });

  it("clamps at total - nVisible", () => {
    useAppStore.setState({ tsFirstChannel: 220 });
    renderHook(() =>
      useChannelViewportShortcuts({ totalChannels: 256, nVisible: 32 }),
    );
    dispatchKey("]", { shiftKey: true });
    expect(useAppStore.getState().tsFirstChannel).toBe(224); // 256 - 32
  });

  it("no-ops in inputs", () => {
    renderHook(() =>
      useChannelViewportShortcuts({ totalChannels: 256, nVisible: 32 }),
    );
    const input = document.createElement("input");
    document.body.appendChild(input);
    dispatchKey("]", {}, input);
    expect(useAppStore.getState().tsFirstChannel).toBe(0);
  });
});
