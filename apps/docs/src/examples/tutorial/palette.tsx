import { usePalette, usePaletteDrag, type PaletteEntry } from "lekh/canvas";

import { rootType } from "./definitions";

function PaletteButton({ entry }: { entry: PaletteEntry }) {
  const { dragHandleProps, isDragging } = usePaletteDrag(entry.type);

  return (
    <button
      type="button"
      {...dragHandleProps}
      style={{ opacity: isDragging ? 0.4 : 1, cursor: "grab" }}
    >
      {entry.label}
    </button>
  );
}

export function Palette() {
  const entries = usePalette();

  return (
    <div style={{ display: "grid", gap: 8, padding: 16 }}>
      {/*
        Structural Blocks are already gone from this list — a column belongs to
        the row that made it, so it is never dragged. The root is not, because
        it is an ordinary Block. Nobody drags one of those either.
      */}
      {entries
        .filter((entry) => entry.type !== rootType)
        .map((entry) => (
          <PaletteButton key={entry.type} entry={entry} />
        ))}
    </div>
  );
}
