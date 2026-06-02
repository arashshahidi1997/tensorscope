import { describe, expect, it } from "vitest";
import { buildViewQueryStatusMaps } from "./viewQueryStatus";

describe("buildViewQueryStatusMaps (refactor-plan N2)", () => {
  it("derives all three status maps from query snapshots", () => {
    const { fetchingByView, erroredByView, staleByView } = buildViewQueryStatusMaps({
      timeseries: { isFetching: true, isError: false, isPlaceholderData: true },
      psd_heatmap: { isFetching: false, isError: true, isPlaceholderData: false },
      navigator: { isFetching: false, isError: false, isPlaceholderData: false },
    });
    expect(fetchingByView).toEqual({
      timeseries: true,
      psd_heatmap: false,
      navigator: false,
    });
    expect(erroredByView).toEqual({
      timeseries: false,
      psd_heatmap: true,
      navigator: false,
    });
    expect(staleByView).toEqual({
      timeseries: true,
      psd_heatmap: false,
      navigator: false,
    });
  });

  it("skips null/undefined snapshots so disabled-query views don't pollute the maps", () => {
    const maps = buildViewQueryStatusMaps({
      timeseries: { isFetching: false, isError: false, isPlaceholderData: false },
      psd_heatmap: null,
      spectrogram: undefined,
    });
    expect(maps.fetchingByView).toEqual({ timeseries: false });
    expect(maps.erroredByView).toEqual({ timeseries: false });
    expect(maps.staleByView).toEqual({ timeseries: false });
  });

  it("treats every view independently — one errored view does not flag others", () => {
    const { erroredByView } = buildViewQueryStatusMaps({
      a: { isFetching: false, isError: true, isPlaceholderData: false },
      b: { isFetching: false, isError: false, isPlaceholderData: false },
    });
    expect(erroredByView.a).toBe(true);
    expect(erroredByView.b).toBe(false);
  });

  it("flags stale-but-not-errored separately from errored", () => {
    // The scientifically dangerous case: fetch in flight, last data on
    // screen is from a PREVIOUS window — not an error, but also not the
    // currently-requested window. erroredByView=false, staleByView=true.
    const { erroredByView, staleByView, fetchingByView } = buildViewQueryStatusMaps({
      timeseries: { isFetching: true, isError: false, isPlaceholderData: true },
    });
    expect(erroredByView.timeseries).toBe(false);
    expect(staleByView.timeseries).toBe(true);
    expect(fetchingByView.timeseries).toBe(true);
  });

  it("returns empty maps for empty input", () => {
    expect(buildViewQueryStatusMaps({})).toEqual({
      fetchingByView: {},
      erroredByView: {},
      staleByView: {},
    });
  });
});
