import { decodeArrowSlice } from "../../api/arrow";
import { SliceMeta } from "./SliceMeta";
import type { SliceViewProps } from "./viewTypes";

export function PlaceholderSliceView({ slice }: SliceViewProps) {
  const decoded = decodeArrowSlice(slice);
  const previewRows = decoded.rows.slice(0, 6);

  return (
    <div className="control-stack">
      <div className="panel-heading">
        <h2>{slice.view_type} Slice</h2>
        <p>Arrow IPC payload decoded client-side.</p>
      </div>

      <SliceMeta slice={slice} />

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {decoded.columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, index) => (
              <tr key={index}>
                {decoded.columns.map((column) => (
                  <td key={column}>{String(row[column] ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
