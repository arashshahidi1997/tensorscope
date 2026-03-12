/**
 * Spatial layout model for electrode arrays. M3 addition.
 *
 * Keeps rendering-agnostic coordinate data separate from view state.
 */

/** One electrode's identity and position in the layout. */
export type ElectrodeCoord = {
  /** Unique electrode identifier within this layout (0-based). */
  id: number;
  /** Raw AP coordinate value (same units as tensor AP coord). */
  ap: number;
  /** Raw ML coordinate value (same units as tensor ML coord). */
  ml: number;
  /** 0-based rank index along AP axis (integer grid position). */
  apIdx: number;
  /** 0-based rank index along ML axis (integer grid position). */
  mlIdx: number;
  /** Optional human-readable label, e.g. "ch-32" or "A1". */
  label?: string;
};

/** Full spatial arrangement of electrodes for a session tensor. */
export type ElectrodeLayout = {
  /** All electrodes in this layout, sorted by (apIdx, mlIdx). */
  electrodes: ElectrodeCoord[];
  /** [min, max] raw AP coordinate. */
  apRange: [number, number];
  /** [min, max] raw ML coordinate. */
  mlRange: [number, number];
  /** Number of distinct AP positions (rows in grid view). */
  nAP: number;
  /** Number of distinct ML positions (columns in grid view). */
  nML: number;
  /** Array geometry hint for renderer selection. */
  geometry: "grid" | "probe" | "custom";
};

/**
 * Build an ElectrodeLayout from flat AP/ML coordinate arrays.
 * `apCoords` and `mlCoords` must have the same length (one entry per electrode).
 */
export function buildElectrodeLayout(
  apCoords: number[],
  mlCoords: number[],
  geometry: ElectrodeLayout["geometry"] = "grid",
): ElectrodeLayout {
  if (apCoords.length !== mlCoords.length) {
    throw new Error("apCoords and mlCoords must have the same length");
  }

  const apSorted = Array.from(new Set(apCoords)).sort((a, b) => a - b);
  const mlSorted = Array.from(new Set(mlCoords)).sort((a, b) => a - b);
  const apRank = new Map(apSorted.map((v, i) => [v, i]));
  const mlRank = new Map(mlSorted.map((v, i) => [v, i]));

  const electrodes: ElectrodeCoord[] = apCoords.map((ap, i) => ({
    id: i,
    ap,
    ml: mlCoords[i],
    apIdx: apRank.get(ap)!,
    mlIdx: mlRank.get(mlCoords[i])!,
  }));

  electrodes.sort((a, b) => a.apIdx - b.apIdx || a.mlIdx - b.mlIdx);

  return {
    electrodes,
    apRange: [apSorted[0], apSorted[apSorted.length - 1]],
    mlRange: [mlSorted[0], mlSorted[mlSorted.length - 1]],
    nAP: apSorted.length,
    nML: mlSorted.length,
    geometry,
  };
}
