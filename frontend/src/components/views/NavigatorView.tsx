import { useEffect, useMemo, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { decodeArrowSlice, extractTimeseriesColumnar } from "../../api/arrow";
import type { SliceViewProps } from "./viewTypes";

export function NavigatorView({
  slice,
  selection,
  onSelectTime,
  timeWindow,
  onTimeWindowChange,
}: SliceViewProps & {
  timeWindow?: [number, number];
  onTimeWindowChange?: (window: [number, number]) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<uPlot | null>(null);
  const onSelectTimeRef = useRef(onSelectTime);
  const onWindowRef = useRef(onTimeWindowChange);
  useEffect(() => { onSelectTimeRef.current = onSelectTime; });
  useEffect(() => { onWindowRef.current = onTimeWindowChange; });

  // Decode once per payload, then collapse all channels into a single mean signal
  const { times, meanValues } = useMemo(() => {
    const decoded = decodeArrowSlice(slice);
    const { times: ts, series } = extractTimeseriesColumnar(decoded);
    if (ts.length === 0 || series.length === 0) return { times: [], meanValues: [] };

    // Average all series into one overview signal
    const mean = ts.map((_, ti) => {
      let sum = 0, count = 0;
      for (const s of series) {
        const v = s.values[ti];
        if (Number.isFinite(v)) { sum += v; count++; }
      }
      return count > 0 ? sum / count : NaN;
    });
    return { times: ts, meanValues: mean };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slice.payload]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || times.length === 0) return;

    chartRef.current?.destroy();
    chartRef.current = null;

    const width = el.clientWidth || el.getBoundingClientRect().width || 900;

    const opts: uPlot.Options = {
      width,
      height: 80,
      legend: { show: false },
      cursor: {
        drag: { setScale: true, x: true, y: false },
        sync: { key: "tsscope-time" },
      },
      axes: [
        { stroke: "#888", size: 24, grid: { stroke: "#222" } },
        { show: false },
      ],
      select: { show: true, left: 0, width: 0, top: 0, height: 80 },
      series: [
        {},
        { stroke: "#73d2de", width: 1, spanGaps: false, fill: "rgba(115,210,222,0.08)" },
      ],
      hooks: {
        setScale: [
          (u, key) => {
            if (key !== "x") return;
            const { min, max } = u.scales.x;
            if (min != null && max != null) {
              onWindowRef.current?.([min, max]);
            }
          },
        ],
      },
    };

    const data: uPlot.AlignedData = [
      new Float64Array(times),
      new Float32Array(meanValues),
    ];

    chartRef.current = new uPlot(opts, data, el);

    // Resize after container settles
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && chartRef.current) chartRef.current.setSize({ width: w, height: 80 });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chartRef.current?.destroy();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [times, meanValues]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || times.length === 0 || !selection) return;
    const x = chart.valToPos(selection.time, "x");
    if (Number.isFinite(x)) chart.setCursor({ left: x, top: -1 });
  }, [selection?.time, times]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const chart = chartRef.current;
    if (!chart) return;
    const bounds = e.currentTarget.getBoundingClientRect();
    const t = chart.posToVal(e.clientX - bounds.left, "x");
    if (Number.isFinite(t)) onSelectTimeRef.current?.(t);
  };

  if (!selection || times.length === 0) return null;

  return (
    <div className="navigator-bar">
      <div
        ref={containerRef}
        onClick={handleClick}
        style={{ cursor: "crosshair", width: "100%" }}
      />
    </div>
  );
}
