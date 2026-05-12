// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./client";
import type {
  EventDecisionExportResponseDTO,
  EventDecisionListDTO,
} from "./types";

const originalFetch = globalThis.fetch;

function mockFetch(response: unknown, init: ResponseInit = { status: 200 }) {
  const fn = vi.fn().mockImplementation(async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify(response), {
      headers: { "Content-Type": "application/json" },
      ...init,
    }),
  );
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

beforeEach(() => {
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("api.exportEventDecisions", () => {
  it("POSTs to /api/v1/events/{stream}/decisions with the batch body", async () => {
    const fetchMock = mockFetch({
      stream: "ripples",
      path: "/data/review/ripples__decisions.parquet",
      format: "parquet",
      n_decisions: 2,
      saved_at: 1715000000000,
    } satisfies EventDecisionExportResponseDTO);

    const res = await api.exportEventDecisions("ripples", {
      decisions: [
        { event_id: 1, status: "accepted", decided_at: 1, tags: [] },
        { event_id: 2, status: "rejected", decided_at: 2, tags: ["artefact"] },
      ],
    });
    expect(res.n_decisions).toBe(2);
    expect(res.format).toBe("parquet");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/events/ripples/decisions");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.decisions).toHaveLength(2);
    expect(body.decisions[1].tags).toEqual(["artefact"]);
  });

  it("URL-encodes stream names with characters needing escape", async () => {
    const fetchMock = mockFetch({
      stream: "a/b stream",
      path: "/x.parquet",
      format: "parquet",
      n_decisions: 0,
      saved_at: 0,
    });
    await api.exportEventDecisions("a/b stream", { decisions: [] });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/v1/events/a%2Fb%20stream/decisions",
    );
  });

  it("throws when the server returns a non-ok status", async () => {
    mockFetch({ code: "forbidden", message: "no dataset dir" }, { status: 403 });
    await expect(
      api.exportEventDecisions("ripples", { decisions: [] }),
    ).rejects.toThrow();
  });
});

describe("api.importEventDecisions", () => {
  it("GETs the decisions endpoint and returns the list payload", async () => {
    const fetchMock = mockFetch({
      stream: "ripples",
      decisions: [
        { event_id: "1", status: "accepted", decided_at: 100, notes: "ok", tags: [] },
      ],
      path: "/data/review/ripples__decisions.parquet",
      format: "parquet",
      saved_at: 1715000000000,
    } satisfies EventDecisionListDTO);

    const res = await api.importEventDecisions("ripples");
    expect(res.decisions).toHaveLength(1);
    expect(res.decisions[0].event_id).toBe("1");
    expect(res.saved_at).toBe(1715000000000);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/v1/events/ripples/decisions",
    );
  });

  it("returns the empty-list shape when the server has nothing saved", async () => {
    mockFetch({
      stream: "ripples",
      decisions: [],
      path: null,
      format: null,
      saved_at: null,
    } satisfies EventDecisionListDTO);

    const res = await api.importEventDecisions("ripples");
    expect(res.decisions).toEqual([]);
    expect(res.saved_at).toBeNull();
    expect(res.path).toBeNull();
  });
});
