import { decodeArrowSlice } from "../../api/arrow";
import type { TensorSliceDTO } from "../../api/types";

type PlaceholderSliceViewProps = {
  slice: TensorSliceDTO;
};

export function PlaceholderSliceView({ slice }: PlaceholderSliceViewProps) {
  const decoded = decodeArrowSlice(slice);
  const previewRows = decoded.rows.slice(0, 6);

  return (
    <div className="control-stack">
      <div className="panel-heading">
        <h2>{slice.view_type} Slice</h2>
        <p>Arrow IPC payload decoded client-side.</p>
      </div>

      <div className="meta-grid">
        <div>
          <span className="meta-label">Encoding</span>
          <strong>{slice.encoding}</strong>
        </div>
        <div>
          <span className="meta-label">Shape</span>
          <strong>{slice.shape.join(" × ")}</strong>
        </div>
        <div>
          <span className="meta-label">Downsample</span>
          <strong>{slice.meta.downsampling?.method ?? "n/a"}</strong>
        </div>
        <div>
          <span className="meta-label">Rows</span>
          <strong>{decoded.rows.length}</strong>
        </div>
      </div>

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
