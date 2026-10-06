import { Canvas, type DropTargetProps } from "lekh-editor/canvas";

/** One faint mark for every place the Block may land. */
function FaintDropTarget({ target, rect, current }: DropTargetProps) {
  // `dropIndicator` already draws the one the pointer picks.
  if (current) return null;
  const across = target.axis === "horizontal";
  return (
    <div
      style={{
        position: "absolute",
        ...rect,
        [across ? "minWidth" : "minHeight"]: 1,
        background: "pink",
        pointerEvents: "none",
      }}
    />
  );
}

export function EmailCanvas() {
  return <Canvas slots={{ dropTarget: FaintDropTarget }} />;
}
