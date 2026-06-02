/**
 * TimeseriesNavStrip — neuroscope-style navigator under a timeseries X axis.
 *
 * One compact row showing:
 *   [Time(s) <input>] [Window(s) <input>] [scrubber: full extent + window highlight] [t0..t1]
 *
 * Interactions:
 *   - Number input → commit on Enter / blur. Time edits move the cursor and
 *     re-center the window; window edits resize around the cursor.
 *   - Click on scrubber → jump window center there (window size unchanged).
 *   - Drag the highlighted region → pan window (cursor follows the centre).
 *
 * The window length is driven by the Window(s) input or the existing time-
 * scale selector — not by edge handles on the strip (those were too fiddly).
 *
 * Latency: during a drag, the highlight is repositioned from local state for
 * instant visual feedback; the actual window is committed to the parent
 * (which triggers the slice refetch) only on pointerup.
 */
import { useEffect, useRef, useState } from "react";

type TimeseriesNavStripProps = {
  /** Full data time extent in seconds. */
  dataRange: [number, number];
  /** Currently visible window in seconds. */
  window: [number, number];
  /** Current time cursor in seconds. */
  cursor: number;
  onCursorChange: (t: number) => void;
  onWindowChange: (w: [number, number]) => void;
};

export function TimeseriesNavStrip({
  dataRange,
  window,
  cursor,
  onCursorChange,
  onWindowChange,
}: TimeseriesNavStripProps) {
  const [t0, t1] = dataRange;
  const [w0, w1] = window;
  const total = Math.max(1e-9, t1 - t0);
  const winSec = Math.max(0, w1 - w0);

  const [timeInput, setTimeInput] = useState(cursor.toFixed(3));
  const [windowInput, setWindowInput] = useState(winSec.toFixed(3));
  // Focus-aware sync: only overwrite the field from external state when the
  // user is NOT editing it. Without this guard, a cursor tick from animation
  // or a paired-agent commit wipes a half-typed value (ephyviewer's seek()
  // disconnects the widget signal for the same reason). See time-transport.md.
  const timeFocused = useRef(false);
  const windowFocused = useRef(false);
  useEffect(() => {
    if (!timeFocused.current) setTimeInput(cursor.toFixed(3));
  }, [cursor]);
  useEffect(() => {
    if (!windowFocused.current) setWindowInput(winSec.toFixed(3));
  }, [winSec]);

  const trackRef = useRef<HTMLDivElement | null>(null);

  // Optimistic highlight: while the user is dragging the window or its
  // edges, paint the highlight from local state and only commit the new
  // window to the parent (which fires a slice refetch) on pointerup.
  // Without this, every pointermove during a drag triggered a network
  // round-trip + Arrow decode + uPlot.setData — visibly laggy on long
  // recordings where each round-trip costs hundreds of ms.
  const [dragWindow, setDragWindow] = useState<[number, number] | null>(null);
  const effectiveW0 = dragWindow ? dragWindow[0] : w0;
  const effectiveW1 = dragWindow ? dragWindow[1] : w1;
  const effectiveWinSec = Math.max(0, effectiveW1 - effectiveW0);

  const commitTime = (raw: string) => {
    const v = parseFloat(raw);
    if (!Number.isFinite(v)) return;
    const clamped = Math.max(t0, Math.min(t1, v));
    onCursorChange(clamped);
    // Re-center current window on the new cursor.
    const half = winSec / 2;
    const lo = Math.max(t0, Math.min(t1 - winSec, clamped - half));
    onWindowChange([lo, lo + winSec]);
  };

  const commitWindow = (raw: string) => {
    const v = parseFloat(raw);
    if (!Number.isFinite(v) || v <= 0) return;
    const clampedW = Math.min(total, v);
    const center = (w0 + w1) / 2;
    const half = clampedW / 2;
    const lo = Math.max(t0, Math.min(t1 - clampedW, center - half));
    onWindowChange([lo, lo + clampedW]);
  };

  // Pixel ↔ time mapping, derived per render from the track element.
  const pxToTime = (px: number, trackW: number) =>
    t0 + Math.max(0, Math.min(1, px / Math.max(1, trackW))) * total;

  const dragRef = useRef<{
    active: boolean;
    startX: number;
    startW: [number, number];
    trackW: number;
  }>({ active: false, startX: 0, startW: [0, 0], trackW: 1 });

  const beginDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (!track) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startW: [w0, w1],
      trackW: track.clientWidth,
    };
    setDragWindow([w0, w1]);
  };

  const onDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.active) return;
    const dxPx = e.clientX - drag.startX;
    const dxSec = (dxPx / Math.max(1, drag.trackW)) * total;
    const [s0, s1] = drag.startW;
    let lo = s0 + dxSec;
    let hi = s1 + dxSec;
    const span = hi - lo;
    if (lo < t0) {
      lo = t0;
      hi = lo + span;
    }
    if (hi > t1) {
      hi = t1;
      lo = hi - span;
    }
    setDragWindow([lo, hi]);
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    dragRef.current.active = false;
    if (dragWindow) {
      onWindowChange(dragWindow);
      setDragWindow(null);
    }
  };

  const onTrackClick = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only fires on track-area clicks; the highlight box's beginDrag does
    // stopPropagation so a click-on-highlight doesn't double-jump.
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const tCenter = pxToTime(e.clientX - rect.left, rect.width);
    const half = winSec / 2;
    const lo = Math.max(t0, Math.min(t1 - winSec, tCenter - half));
    onWindowChange([lo, lo + winSec]);
    onCursorChange(Math.max(t0, Math.min(t1, tCenter)));
  };

  // Window highlight uses the optimistic local state during drag so the
  // box follows the pointer even though the parent state is unchanged.
  const winLeftPct = ((effectiveW0 - t0) / total) * 100;
  const winWidthPct = (effectiveWinSec / total) * 100;
  const cursorPct = ((cursor - t0) / total) * 100;

  return (
    <div className="ts-nav-strip">
      <label className="ts-nav-field">
        <span>Time (s)</span>
        <input
          type="number"
          step={Math.max(0.001, winSec / 100)}
          value={timeInput}
          onChange={(e) => setTimeInput(e.target.value)}
          onFocus={() => { timeFocused.current = true; }}
          onBlur={(e) => { timeFocused.current = false; commitTime(e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      </label>
      <label className="ts-nav-field">
        <span>Window (s)</span>
        <input
          type="number"
          step={Math.max(0.001, winSec / 10)}
          min={0.001}
          value={windowInput}
          onChange={(e) => setWindowInput(e.target.value)}
          onFocus={() => { windowFocused.current = true; }}
          onBlur={(e) => { windowFocused.current = false; commitWindow(e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      </label>
      <div
        ref={trackRef}
        className="ts-nav-track"
        onPointerDown={onTrackClick}
        title={`Click to jump · drag highlight to pan · drag edges to resize`}
      >
        <div
          className="ts-nav-window"
          style={{ left: `${winLeftPct}%`, width: `${winWidthPct}%` }}
          onPointerDown={beginDrag}
          onPointerMove={onDragMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          title="Drag to pan; window length is set via the Window(s) input"
        />
        <div
          className="ts-nav-cursor"
          style={{ left: `${cursorPct}%` }}
          aria-hidden
        />
      </div>
      <span className="ts-nav-extent">{formatRange(t0, t1)}</span>
    </div>
  );
}

function formatRange(t0: number, t1: number): string {
  const fmt = (v: number) => (v >= 100 ? v.toFixed(0) : v.toFixed(2));
  return `${fmt(t0)} – ${fmt(t1)} s`;
}
