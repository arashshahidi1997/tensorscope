/**
 * G1 geometry regression guard (npix-event-tooling-plan.md, Track G).
 *
 * Pins "a fixed DISPLAY COLUMN is a fixed ML" through the whole
 * decode → derive → render-layout chain: a synthetic grid with an ML
 * gradient must land as VERTICAL stripes in the renderer's value image,
 * regardless of the wire dim order (the served ECoG tensor is
 * `(time, ML, AP)`; the extractor reads AP/ML BY NAME).
 *
 * CONVENTION NOTE (recorded per the spec's [DECISION]): this branch
 * (`feat/npix-viewer`, off master e220c59) encodes the AP-MAJOR flat id
 * (`ap * nML + ml` — spatialGrid.ts, ChannelGridRenderer cellMap/hitTest,
 * colorRange mask keys). ADR-0012 (currently only on
 * `feat/longfile-neuroscope`) standardizes ML-major (`ml * n_ap + ap`).
 * Internally consistent here; at merge one side must convert — this test
 * is the tripwire: if the renderer layout or extractor axis mapping is
 * flipped without updating the whole chain, the stripes go horizontal and
 * this fails.
 */
import { describe, expect, it } from "vitest";
import { extractSpatialCellsV2, type LabeledTensor } from "../../api/v2-arrow";
import { deriveSpatialGrid } from "./spatialGrid";
import { ChannelGridRenderer } from "./ChannelGridRenderer";

const N_AP = 4;
const N_ML = 3;
const AP_COORD = [0, 1, 2, 3];
const ML_COORD = [0, 1, 2];

/** Synthetic cube whose value is a pure ML gradient (value = ml rank * 10). */
function mlGradientTensor(dims: ["AP", "ML"] | ["ML", "AP"]): LabeledTensor {
  const data = new Float32Array(N_AP * N_ML);
  for (let a = 0; a < N_AP; a++) {
    for (let m = 0; m < N_ML; m++) {
      const flat = dims[0] === "AP" ? a * N_ML + m : m * N_AP + a;
      data[flat] = m * 10;
    }
  }
  return {
    meta: {
      version: "2.0",
      dims: [...dims],
      shape: dims[0] === "AP" ? [N_AP, N_ML] : [N_ML, N_AP],
      dtype: "float32",
      units: null,
      attrs: {},
      display_transforms: [],
    },
    data,
    coords: { AP: Float64Array.from(AP_COORD), ML: Float64Array.from(ML_COORD) },
  };
}

describe("G1: fixed display column = fixed ML (decode → render layout)", () => {
  for (const dims of [["AP", "ML"], ["ML", "AP"]] as const) {
    it(`ML gradient renders as vertical stripes for wire dims (${dims.join(", ")})`, () => {
      const cells = extractSpatialCellsV2(mlGradientTensor([...dims] as ["AP", "ML"]));
      expect(cells).toHaveLength(N_AP * N_ML);

      const grid = deriveSpatialGrid(cells);
      expect(grid.nAP).toBe(N_AP);
      expect(grid.nML).toBe(N_ML);

      // Paint each cell into the renderer's image layout (width = nML) and
      // record which value lands in which display column.
      const valueByColumn = new Map<number, Set<number>>();
      for (const cell of grid.cells) {
        const px = ChannelGridRenderer.cellPixelOffset(cell.apIdx, cell.mlIdx, grid.nML);
        const col = (px / 4) % grid.nML;
        const row = Math.floor(px / 4 / grid.nML);
        // x = ml, y = ap: the display offset separates axes correctly.
        expect(col).toBe(cell.mlIdx);
        expect(row).toBe(cell.apIdx);
        if (!valueByColumn.has(col)) valueByColumn.set(col, new Set());
        valueByColumn.get(col)!.add(cell.value);
      }

      // Vertical stripes: every display column holds exactly ONE value
      // (the ML gradient), and the stripe values are the ML ranks * 10.
      expect(valueByColumn.size).toBe(N_ML);
      for (const [col, values] of valueByColumn) {
        expect([...values]).toEqual([col * 10]);
      }
    });
  }

  it("flat id stays AP-major on this branch (ap*nML+ml) — see ADR-0012 note above", () => {
    const cells = extractSpatialCellsV2(mlGradientTensor(["AP", "ML"]));
    const grid = deriveSpatialGrid(cells);
    for (const cell of grid.cells) {
      expect(cell.id).toBe(cell.apIdx * grid.nML + cell.mlIdx);
    }
  });
});
