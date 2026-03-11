import { decodeArrowSlice } from "../../api/arrow";
import type { TensorSliceDTO } from "../../api/types";

type SliceMetaProps = {
  slice: TensorSliceDTO;
};

export function SliceMeta({ slice }: SliceMetaProps) {
  const decoded = decodeArrowSlice(slice);

  return (
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
  );
}
