import type { ReactNode } from "react";
import { useBlockDrag, type BlockChromeProps } from "lekh-editor/canvas";

/**
 * A grip on the selected Block's top-left corner.
 *
 * While it is drawn, every Block moves only by its grip. A press on any Block's
 * body selects it and leaves it where it is.
 */
export function Selection({ block, rect }: BlockChromeProps): ReactNode {
  const { dragHandleProps } = useBlockDrag(block.id);

  return (
    <>
      <div
        style={{
          position: "absolute",
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          outline: "2px solid #4f46e5",
          pointerEvents: "none",
        }}
      />
      <button
        type="button"
        aria-label="Move"
        style={{
          position: "absolute",
          top: rect.top,
          left: rect.left - 28,
          width: 24,
          height: 24,
          cursor: "grab",
          // The Slot layer ignores the pointer. A grip takes it back.
          pointerEvents: "auto",
        }}
        {...dragHandleProps}
      >
        ⠿
      </button>
    </>
  );
}
