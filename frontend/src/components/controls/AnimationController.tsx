import { useEffect, useRef, useState } from "react";
import { useSelectionStore } from "../../store/selectionStore";

type AnimationControllerProps = {
  /** Full time extent of the recording, [t0, t1] in seconds. */
  timeRange: [number, number];
  /** Frames per second (default 10). */
  fps?: number;
};

export function AnimationController({
  timeRange,
  fps = 10,
}: AnimationControllerProps) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);

  // Expose speed/fps/timeRange to the rAF loop without re-creating the effect.
  // timeRange MUST go through a ref: the parent often passes a fresh [t0,t1]
  // literal each render, and listing it in the effect deps would tear down and
  // rebuild the loop (resetting lastTick → stutter). See time-transport.md.
  const speedRef = useRef(speed);
  const fpsRef = useRef(fps);
  const timeRangeRef = useRef(timeRange);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { fpsRef.current = fps; }, [fps]);
  useEffect(() => { timeRangeRef.current = timeRange; }, [timeRange]);

  // rAF animation loop — starts when playing becomes true, stops otherwise.
  useEffect(() => {
    if (!playing) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    lastTickRef.current = performance.now();

    function tick(now: number) {
      const elapsed = now - lastTickRef.current;
      const frameInterval = 1000 / (fpsRef.current * speedRef.current);

      if (elapsed >= frameInterval) {
        // Wall-clock advance (like ephyviewer's on_timer_play_interval): the
        // step is the real elapsed time × speed, so playback tracks real time
        // regardless of frame jitter.
        const [lo, hi] = timeRangeRef.current;
        const advance = (elapsed / 1000) * speedRef.current;
        const t = useSelectionStore.getState().timeCursor;
        const next = t + advance > hi ? lo : t + advance;
        useSelectionStore.getState().setTimeCursor(next);
        lastTickRef.current = now;
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [playing]);

  // A "step" is one frame (1/fps) regardless of playback speed — speed scales
  // continuous playback, not discrete steps.
  const stepForward = () => {
    const [, hi] = timeRangeRef.current;
    const t = useSelectionStore.getState().timeCursor;
    useSelectionStore.getState().setTimeCursor(Math.min(hi, t + 1 / fps));
  };

  const stepBack = () => {
    const [lo] = timeRangeRef.current;
    const t = useSelectionStore.getState().timeCursor;
    useSelectionStore.getState().setTimeCursor(Math.max(lo, t - 1 / fps));
  };

  const handleStop = () => {
    setPlaying(false);
    useSelectionStore.getState().setTimeCursor(timeRangeRef.current[0]);
  };

  // Zustand subscription — causes a re-render on every cursor change for the
  // label display only. The animation loop itself bypasses React via getState().
  const timeCursor = useSelectionStore((s) => s.timeCursor);

  return (
    <div className="animation-controller">
      <button onClick={handleStop} disabled={!playing} title="Stop">
        ■
      </button>
      <button onClick={stepBack} title="Step back">
        ⏮
      </button>
      <button
        onClick={() => setPlaying(!playing)}
        title={playing ? "Pause" : "Play"}
      >
        {playing ? "⏸" : "▶"}
      </button>
      <button onClick={stepForward} title="Step forward">
        ⏭
      </button>
      <select
        value={speed}
        onChange={(e) => {
          const v = Number(e.target.value);
          // Guard against 0 / NaN → frameInterval = Infinity would freeze play.
          if (Number.isFinite(v) && v > 0) setSpeed(v);
        }}
      >
        <option value={0.25}>0.25×</option>
        <option value={0.5}>0.5×</option>
        <option value={1}>1×</option>
        <option value={2}>2×</option>
        <option value={4}>4×</option>
      </select>
      <span className="anim-time">{timeCursor.toFixed(3)}s</span>
    </div>
  );
}
