import type { EventRecordDTO, SelectionDTO, TensorSliceDTO } from "../../api/types";

export type SliceViewProps = {
  slice: TensorSliceDTO;
  selection?: SelectionDTO;
  events?: EventRecordDTO[];
  /**
   * Called when the user clicks / commits a new time cursor.
   * Triggers a server round-trip; use for precise point selection.
   */
  onSelectTime?: (time: number) => void;
  onSelectCell?: (ap: number, ml: number) => void;
  /**
   * Called when the view's visible time range changes (pan, zoom, drag).
   * Store-local update — no server round-trip.
   * Views that publish window changes participate in the overview↔detail
   * multiscale contract: navigator ↔ timeseries ↔ spectrogram.
   */
  onTimeWindowChange?: (window: [number, number]) => void;
};
