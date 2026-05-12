/**
 * Bokeh-style crosshair overlay — a thin vertical line at the current
 * cross-view `hoverTime` (and optionally a horizontal line at
 * `hoverFreq`). Visible only when the user has the `crosshair`
 * inspector toggled on (default: on).
 *
 * Drop this in as a sibling of the chart canvas. The chart's own
 * (committed) selection cursor is unrelated and still renders
 * independently — this overlay is the *hover* indicator.
 */
import { useHoverStore } from "../../store/hoverStore";
import { hasInspector, useGestureStore } from "../../store/gestureStore";

type Props = {
  /** Visible-time range that maps to the overlay's full width. */
  tLo: number;
  tHi: number;
  /** Optional visible-freq range for the horizontal line. */
  fLo?: number;
  fHi?: number;
  /** `freqLog` mirrors the spectrogram's freq-scale toggle. */
  freqLog?: boolean;
};

export function CrosshairOverlay({ tLo, tHi, fLo, fHi, freqLog = false }: Props) {
  const hoverTime = useHoverStore((s) => s.hoverTime);
  const hoverFreq = useHoverStore((s) => s.hoverFreq);
  const inspectors = useGestureStore((s) => s.inspectors);
  if (!hasInspector(inspectors, "crosshair")) return null;
  if (tHi <= tLo) return null;

  const showX = hoverTime != null && hoverTime >= tLo && hoverTime <= tHi;
  const showY =
    fLo != null && fHi != null && fHi > fLo && hoverFreq != null && hoverFreq >= fLo && hoverFreq <= fHi;

  return (
    <>
      {showX && (
        <div
          aria-hidden
          className="crosshair-vline"
          style={{ left: `${((hoverTime! - tLo) / (tHi - tLo)) * 100}%` }}
        />
      )}
      {showY && (
        <div
          aria-hidden
          className="crosshair-hline"
          style={{
            top: `${
              freqLog
                ? ((Math.log10(fHi!) - Math.log10(hoverFreq!)) /
                    (Math.log10(fHi!) - Math.log10(fLo!))) *
                  100
                : ((fHi! - hoverFreq!) / (fHi! - fLo!)) * 100
            }%`,
          }}
        />
      )}
    </>
  );
}
