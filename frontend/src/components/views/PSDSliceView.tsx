import { useEffect, useMemo, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { decodeArrowSlice, extractFreqCurve } from "../../api/arrow";
import type { SliceViewProps } from "./viewTypes";

export function PSDSliceView({ slice, selection }: SliceViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<uPlot | null>(null);

  // Decode once per payload
  const { freqs, values } = useMemo(() => {
    const decoded = decodeArrowSlice(slice);
    return extractFreqCurve(decoded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slice.payload]);

  useEffect(() => {
    if (!containerRef.current || freqs.length === 0) return;

    chartRef.current?.destroy();
    chartRef.current = null;

    const width = containerRef.current.clientWidth || 900;

    const opts: uPlot.Options = {
      width,
      height: 220,
      axes: [
        { label: "Frequency (Hz)", stroke: "#aaa", grid: { stroke: "#222" } },
        { label: "Power", stroke: "#aaa", grid: { stroke: "#1a1a1a" } },
      ],
      series: [
        {},
        { label: "Mean PSD", stroke: "#73d2de", width: 2 },
      ],
      cursor: { drag: { setScale: false } },
    };

    const data: uPlot.AlignedData = [
      new Float64Array(freqs),
      new Float32Array(values),
    ];

    chartRef.current = new uPlot(opts, data, containerRef.current);

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freqs, values]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || freqs.length === 0 || !selection) return;
    const x = chart.valToPos(selection.freq, "x");
    if (Number.isFinite(x)) chart.setCursor({ left: x, top: -1 });
  }, [selection?.freq, freqs]);

  if (!selection || freqs.length === 0) return null;

  return (
    <div>
      <div ref={containerRef} className="uplot-wrap" />
    </div>
  );
}
