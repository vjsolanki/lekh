import type { ReactNode } from "react";
import { useEditor, type DropRefusalProps } from "lekh/canvas";

import { refusalText } from "./nesting-refusal";

/**
 * Where a refusal is shown.
 *
 * The one Slot given a pointer as well as a rectangle, because a refusal has
 * two positions and they are rarely the same one. It is *about* a container —
 * often a full-width Section, sometimes the whole email — and it has to be
 * *read* at the cursor, which is where somebody is looking.
 *
 * The pointer is always inside `rect`, so the two are near each other even
 * when they are not the same place.
 */
export function DropRefusal({
  refusal,
  rect,
  pointer,
}: DropRefusalProps): ReactNode {
  const editor = useEditor();

  return (
    <>
      <div
        style={{
          position: "absolute",
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          outline: "2px dashed #b91c1c",
          background: "rgb(185 28 28 / 8%)",
          pointerEvents: "none",
        }}
      />
      <div
        role="status"
        style={{
          position: "absolute",
          left: pointer.x,
          top: pointer.y,
          // Clear of the cursor, which is already saying the same thing.
          transform: "translate(14px, 14px)",
          maxWidth: 220,
          padding: "4px 8px",
          borderRadius: 4,
          background: "#101319",
          color: "white",
          pointerEvents: "none",
        }}
      >
        {refusalText(refusal, editor)}
      </div>
    </>
  );
}
