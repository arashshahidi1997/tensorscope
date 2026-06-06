/**
 * ColorBar — vertical color-scale legend for heatmap views (audit S3).
 *
 * The pre-existing PSD heatmap, spectrogram, spatial map, and PSD spatial
 * views render colored cells but never show users what value each color
 * maps to.  This component renders a thin vertical strip filled with the
 * supplied colormap LUT, plus 3–4 magnitude-aware tick labels along the
 * right edge.
 *
 * Sized to fit alongside an existing heatmap canvas — pass `height` in px
 * (defaults to "100%" via flex) and the parent's grid/flex layout decides
 * the width footprint.
 */
import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import type { ColormapName } from "./colormaps";
import { getColormapLUT } from "./colormaps";
import { formatTickLabel } from "./AxisTicks";

type ColorBarProps = {
  colormap: ColormapName;
  /** Data-domain min/max — labels are derived from these. */
  min: number;
  max: number;
  /** Caption shown vertically alongside the bar (e.g. "Power (dB)"). */
  label?: string;
  /** Number of tick labels (default 4). */
  tickCount?: number;
  /** Width in px for the colored strip (defaults to 14 px). */
  barWidth?: number;
  /** Optional className on the outer wrapper. */
  className?: string;
};

export function ColorBar({
  colormap,
  min,
  max,
  label,
  tickCount = 4,
  barWidth = 14,
  className,
}: ColorBarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const lut = getColormapLUT(colormap);
    const dpr = window.devicePixelRatio || 1;
    const w = barWidth;
    const h = canvas.clientHeight;
    if (h <= 0) return;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Build a 1×256 ImageData and stretch-blit vertically. Top of canvas =
    // max value (LUT index 255), bottom = min (LUT index 0), so a tick at
    // "100% from bottom" maps to max.
    const img = ctx.createImageData(1, 256);
    for (let i = 0; i < 256; i++) {
      const src = (255 - i) * 4; // flip so top = max
      const dst = i * 4;
      img.data[dst + 0] = lut[src + 0];
      img.data[dst + 1] = lut[src + 1];
      img.data[dst + 2] = lut[src + 2];
      img.data[dst + 3] = 255;
    }
    const tmp = document.createElement("canvas");
    tmp.width = 1;
    tmp.height = 256;
    tmp.getContext("2d")!.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
  }, [colormap, barWidth]);

  // Magnitude-aware ticks across the data range.
  const range = max - min;
  const ticks: Array<{ value: number; pct: number; label: string }> =
    Number.isFinite(min) && Number.isFinite(max) && range > 0
      ? Array.from({ length: tickCount }, (_, i) => {
          const t = i / (tickCount - 1);
          const value = min + t * range;
          return { value, pct: t * 100, label: formatTickLabel(value) };
        })
      : [];

  return (
    <div
      className={`ts-colorbar ${className ?? ""}`}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "stretch",
        gap: 4,
        // The end tick labels are centered on the bar's top/bottom edges
        // (bottom:0%/100% + translateY(50%)), so each pokes ~half a line-height
        // outside the bar. Without this inset that overflow pushed the panel
        // body's scrollHeight past its height → a stray vertical scrollbar on
        // the spatial panels. Reserve room so the labels stay within the box.
        padding: "8px 0",
        boxSizing: "border-box",
      }}
    >
      {label && (
        <div
          className="ts-colorbar-label"
          style={{
            writingMode: "vertical-rl",
            transform: "rotate(180deg)",
            fontSize: 9,
            color: "var(--muted, #8b949e)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            userSelect: "none",
          }}
        >
          {label}
        </div>
      )}
      <div
        style={{
          width: barWidth,
          minWidth: barWidth,
          height: "100%",
          position: "relative",
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            border: "1px solid var(--border, #2a2f36)",
          }}
        />
      </div>
      <div
        style={{
          position: "relative",
          minWidth: 32,
          fontSize: 9,
          color: "var(--muted, #8b949e)",
          userSelect: "none",
        }}
      >
        {ticks.map((t) => (
          <span
            key={t.value}
            style={{
              position: "absolute",
              bottom: `${t.pct}%`,
              left: 2,
              transform: "translateY(50%)",
              whiteSpace: "nowrap",
            }}
          >
            {t.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * ColorScaleOverlay — a compact ColorBar floated *inside* a plot's area as an
 * absolute overlay, so it adds a value legend WITHOUT consuming layout width
 * (which would shrink the plot and break the timeseries↔spectrogram time-axis
 * alignment). Used by the spectrogram and the timeseries raster mode. The host
 * must be `position: relative`. `pointer-events: none` so clicks/hover still
 * reach the canvas beneath.
 */
export function ColorScaleOverlay({
  colormap,
  min,
  max,
  label,
  style,
}: {
  colormap: ColormapName;
  min: number;
  max: number;
  label?: string;
  /** Position override (defaults to the top-right corner of the plot). */
  style?: CSSProperties;
}) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        top: 8,
        bottom: 8,
        right: 6,
        zIndex: 6,
        pointerEvents: "none",
        display: "flex",
        alignItems: "stretch",
        background: "rgba(13,17,23,0.55)",
        border: "1px solid rgba(148,163,184,0.18)",
        borderRadius: 4,
        padding: "0 3px",
        backdropFilter: "blur(1px)",
        ...style,
      }}
    >
      <ColorBar colormap={colormap} min={min} max={max} label={label} tickCount={3} barWidth={9} />
    </div>
  );
}
