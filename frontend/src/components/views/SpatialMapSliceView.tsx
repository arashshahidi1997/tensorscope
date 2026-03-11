import { decodeArrowSlice, extractSpatialCells } from "../../api/arrow";
import type { SliceViewProps } from "./viewTypes";

function hsl(value: number, min: number, max: number): string {
  if (max === min) return "hsl(200 50% 30%)";
  const t = (value - min) / (max - min);
  const hue = 220 - t * 160;          // blue → green
  const light = 15 + t * 45;
  return `hsl(${hue} 70% ${light}%)`;
}

export function SpatialMapSliceView({ slice, selection, onSelectCell }: SliceViewProps) {
  if (!selection) return null;

  const decoded = decodeArrowSlice(slice);
  const cells = extractSpatialCells(decoded);
  if (cells.length === 0) return null;

  const nML = Math.max(...cells.map((c) => c.ml)) + 1;
  const minV = Math.min(...cells.map((c) => c.value));
  const maxV = Math.max(...cells.map((c) => c.value));

  return (
    <div>
      <div
        className="spatial-heatmap"
        style={{ gridTemplateColumns: `repeat(${nML}, 22px)` }}
        title="Click a cell to select AP/ML"
      >
        {cells.map((cell) => (
          <button
            key={`${cell.ap}-${cell.ml}`}
            type="button"
            className={
              cell.ap === selection.ap && cell.ml === selection.ml
                ? "spatial-cell selected"
                : "spatial-cell"
            }
            style={{ background: hsl(cell.value, minV, maxV) }}
            onClick={() => onSelectCell?.(cell.ap, cell.ml)}
            title={`AP ${cell.ap}, ML ${cell.ml}: ${cell.value.toFixed(3)}`}
          />
        ))}
      </div>
    </div>
  );
}
