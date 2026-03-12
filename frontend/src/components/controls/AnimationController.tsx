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

  // Expose speed and fps to the rAF loop without re-creating the effect.
  const speedRef = useRef(speed);
  const fpsRef = useRef(fps);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { fpsRef.current = fps; }, [fps]);

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
        const advance = (elapsed / 1000) * speedRef.current;
        const t = useSelectionStore.getState().timeCursor;
        const next = t + advance > timeRange[1] ? timeRange[0] : t + advance;
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
  }, [playing, timeRange]);

  const stepForward = () => {
    const advance = speed / fps;
    const t = useSelectionStore.getState().timeCursor;
    useSelectionStore.getState().setTimeCursor(
      Math.min(timeRange[1], t + advance),
    );
  };

  const stepBack = () => {
    const retreat = speed / fps;
    const t = useSelectionStore.getState().timeCursor;
    useSelectionStore.getState().setTimeCursor(
      Math.max(timeRange[0], t - retreat),
    );
  };

  const handleStop = () => {
    setPlaying(false);
    useSelectionStore.getState().setTimeCursor(timeRange[0]);
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
        onChange={(e) => setSpeed(Number(e.target.value))}
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
