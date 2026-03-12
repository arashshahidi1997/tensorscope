import { useCallback, useRef } from "react";

type ResizeHandleProps = {
  /** "vertical" = column divider (drags left/right), "horizontal" = row divider (drags up/down) */
  direction: "vertical" | "horizontal";
  /** Called continuously during drag with the delta in px from the drag start position. */
  onResize: (delta: number) => void;
};

/**
 * A thin drag handle for resizing panels.
 * Uses pointer capture for smooth dragging even when the cursor leaves the handle.
 */
export function ResizeHandle({ direction, onResize }: ResizeHandleProps) {
  const startRef = useRef(0);
  const draggingRef = useRef(false);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      draggingRef.current = true;
      startRef.current = direction === "vertical" ? e.clientX : e.clientY;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [direction],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      const current = direction === "vertical" ? e.clientX : e.clientY;
      onResize(current - startRef.current);
    },
    [direction, onResize],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      e.currentTarget.releasePointerCapture(e.pointerId);
    },
    [],
  );

  const className =
    direction === "vertical" ? "resize-handle resize-handle-v" : "resize-handle resize-handle-h";

  return (
    <div
      className={className}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    />
  );
}
