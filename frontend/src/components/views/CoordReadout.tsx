/**
 * CoordReadout — a small "@ …" chip overlaid on a plot's corner showing the
 * current selected (or hovered) coordinate for that view: time / freq for the
 * time-axis plots, AP·ML (or channel) for the spatial plots. Absolute overlay
 * with `pointer-events: none`, so it never consumes layout width or blocks the
 * canvas beneath. Host must be `position: relative`.
 */
import type { CSSProperties } from "react";

export function CoordReadout({
  text,
  muted = false,
  style,
}: {
  /** Already-formatted coordinate string, e.g. "2.006 s · 12.5 Hz". */
  text: string | null;
  /** Dim it slightly when showing the selected (not actively-hovered) value. */
  muted?: boolean;
  style?: CSSProperties;
}) {
  if (!text) return null;
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        bottom: 4,
        left: 4,
        zIndex: 6,
        pointerEvents: "none",
        fontSize: 11,
        lineHeight: 1.3,
        color: muted ? "#8b949e" : "#c9d1d9",
        background: "rgba(13,17,23,0.66)",
        padding: "1px 6px",
        borderRadius: 4,
        whiteSpace: "nowrap",
        fontVariantNumeric: "tabular-nums",
        userSelect: "none",
        ...style,
      }}
    >
      <span style={{ opacity: 0.55, marginRight: 3 }}>@</span>
      {text}
    </div>
  );
}

/** Format a time value in seconds for the readout. */
export function fmtTime(s: number | null | undefined): string | null {
  return s != null && Number.isFinite(s) ? `${s.toFixed(3)} s` : null;
}

/** Format a frequency in Hz for the readout. */
export function fmtFreq(f: number | null | undefined): string | null {
  return f != null && Number.isFinite(f) && f > 0 ? `${f.toFixed(1)} Hz` : null;
}

/** Join the present parts with " · ". */
export function joinCoords(parts: Array<string | null | undefined>): string | null {
  const present = parts.filter((p): p is string => !!p);
  return present.length ? present.join(" · ") : null;
}
