import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./client";
import type { TensorSliceRequestDTO } from "./types";

afterEach(() => vi.restoreAllMocks());

const REQ = { view_type: "timeseries" } as unknown as TensorSliceRequestDTO;

function mockFetch() {
  const fetchMock = vi.fn(
    (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
      Promise.resolve({ ok: true, json: async () => ({}) } as Response),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("getTensorSlice — AbortSignal wiring (Phase D)", () => {
  it("forwards the AbortSignal to fetch so a superseded pan/zoom request is cancelled", async () => {
    const fetchMock = mockFetch();
    const ctrl = new AbortController();
    await api.getTensorSlice("sig", REQ, ctrl.signal);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(ctrl.signal);
  });

  it("works without a signal (optional)", async () => {
    const fetchMock = mockFetch();
    await api.getTensorSlice("sig", REQ);
    expect(fetchMock.mock.calls[0][1]?.signal).toBeUndefined();
  });
});
