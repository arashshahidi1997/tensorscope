import { tableFromIPC } from "apache-arrow";
import type { TensorSliceDTO } from "./types";

export type DecodedSlice = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
};

function base64ToUint8Array(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function decodeArrowSlice(slice: TensorSliceDTO): DecodedSlice {
  const table = tableFromIPC(base64ToUint8Array(slice.payload));
  const columns = table.schema.fields.map((field) => field.name);
  const rows = Array.from(table).map((row) => {
    const record: Record<string, unknown> = {};
    for (const column of columns) {
      record[column] = row[column as keyof typeof row];
    }
    return record;
  });
  return { columns, rows };
}
