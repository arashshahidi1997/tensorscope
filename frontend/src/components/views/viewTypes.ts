import type { EventRecordDTO, SelectionDTO, TensorSliceDTO } from "../../api/types";

export type SliceViewProps = {
  slice: TensorSliceDTO;
  selection?: SelectionDTO;
  events?: EventRecordDTO[];
  onSelectTime?: (time: number) => void;
  onSelectCell?: (ap: number, ml: number) => void;
};
