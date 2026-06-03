/**
 * TrackStack — the stack of auxiliary, time-aligned context lanes pinned under
 * the navigator. Generalizes the old single hypnogram strip: every context
 * track (categorical band like brainstate, scalar trace like speed) renders as
 * one lane, sharing the recording's time axis, the visible-window box, and the
 * cursor.
 *
 * Each track is rendered through its own <TrackLane> child so the number of
 * data-fetching hooks per component stays fixed regardless of how many tracks a
 * session carries.
 */
import { useTrackIntervalsQuery, useTrackSeriesQuery, useTracksQuery } from "../../api/queries";
import type { TrackMetaDTO } from "../../api/types";
import { useAppStore } from "../../store/appStore";
import { HypnogramView } from "./HypnogramView";
import { ScalarTrackLane } from "./ScalarTrackLane";
import { trackTimeRange, visibleTracks } from "./trackLogic";

type TrackStackProps = {
  /** Current visible time window (for the window box on each lane). */
  timeWindow: [number, number];
  /** Current time cursor position. */
  timeCursor: number;
  onSelectTime: (t: number) => void;
};

function TrackLane({ track, timeWindow, timeCursor, onSelectTime }: { track: TrackMetaDTO } & TrackStackProps) {
  const range = trackTimeRange(track);
  const t0 = range?.[0];
  const t1 = range?.[1];
  const isCategorical = track.kind === "categorical";

  // Fetch the full track range once (decimated for scalar); the lane shows the
  // whole session with a window box, like the navigator/hypnogram overview.
  const intervalsQuery = useTrackIntervalsQuery(track.name, isCategorical && range != null, t0, t1);
  const seriesQuery = useTrackSeriesQuery(track.name, !isCategorical && range != null, t0, t1, 2000);

  if (range == null) return null;

  if (isCategorical) {
    const intervals = intervalsQuery.data ?? [];
    if (intervals.length === 0) return null;
    return (
      <HypnogramView
        intervals={intervals}
        timeRange={range}
        timeWindow={timeWindow}
        timeCursor={timeCursor}
        onSelectTime={onSelectTime}
      />
    );
  }

  const series = seriesQuery.data;
  if (!series || series.t.length === 0) return null;
  const label = track.units ? `${track.name} (${track.units})` : track.name;
  return (
    <ScalarTrackLane
      series={series}
      label={label}
      timeRange={range}
      timeWindow={timeWindow}
      timeCursor={timeCursor}
      onSelectTime={onSelectTime}
    />
  );
}

export function TrackStack({ timeWindow, timeCursor, onSelectTime }: TrackStackProps) {
  const tracksQuery = useTracksQuery();
  const trackVisibility = useAppStore((s) => s.trackVisibility);
  const tracks = tracksQuery.data ?? [];

  // Missing key = visible (lanes show by default for a multimodal session).
  const visible = visibleTracks(tracks, trackVisibility);
  if (visible.length === 0) return null;

  return (
    <div className="track-stack" style={{ display: "flex", flexDirection: "column" }}>
      {visible.map((track) => (
        <TrackLane
          key={track.name}
          track={track}
          timeWindow={timeWindow}
          timeCursor={timeCursor}
          onSelectTime={onSelectTime}
        />
      ))}
    </div>
  );
}
