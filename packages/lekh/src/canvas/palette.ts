"use client";

import { useDraggable } from "@dnd-kit/react";
import { useMemo } from "react";

import { useEditor } from "./context";
import { paletteDraggableId, type DragPayload } from "./drag";
import { isRefusing, useDragSessionState } from "./session";

/** One Block Definition, as the data a palette needs to offer it. */
export interface PaletteEntry {
  readonly type: string;
  readonly label: string;
}

/**
 * Props to spread onto whatever element should start a drag.
 *
 * Deliberately opaque: it carries no dnd-kit type, so the drag backend can
 * change without breaking a Consumer (ADR-0008).
 */
export interface DragHandleProps {
  readonly ref: (element: HTMLElement | null) => void;
}

/** What it takes to drag one palette entry onto the Canvas. */
export interface PaletteDrag {
  readonly dragHandleProps: DragHandleProps;
  readonly isDragging: boolean;
  /**
   * Whether this entry's drag is currently over somewhere that will not take
   * it — so the entry in the Author's hand can say so too.
   *
   * False while the drag is merely off the Canvas, which is how an Author
   * abandons one rather than a refusal, and false for every entry that is not
   * the one being dragged.
   */
  readonly isRefused: boolean;
}

/**
 * The Blocks an Author can place, in the order they were composed.
 *
 * Data only — the Consumer renders the palette in their own design system and
 * filters it further if they want to. What comes out here is the composed set
 * minus the `structural` Definitions, and nothing else.
 *
 * That is a narrower rule than it looks, and the line is worth stating: the
 * library removes only what a Definition has *declared* unplaceable, and never
 * filters by taste. A structural Block is part of another Block's shape and its
 * own Definition says so, so obeying it is not guessing. The root type stays in
 * — it is an ordinary Definition, a Consumer may have a reason to list it, and
 * dropping it remains their decision.
 *
 * Left in, a structural entry would not be a merely useless button. It would be
 * a working one: dropped into the container that owns the type it would be
 * accepted, which is the two-gesture flow that removing it exists to delete.
 */
export function usePalette(): readonly PaletteEntry[] {
  const editor = useEditor();
  return useMemo(
    () =>
      editor
        .getDefinitions()
        .filter((definition) => definition.structural !== true)
        .map((definition) => ({
          type: definition.type,
          label: definition.label,
        })),
    [editor],
  );
}

/**
 * Make one palette entry draggable onto the Canvas.
 *
 * Called from the Consumer's own component, so the palette stays theirs:
 *
 * ```tsx
 * function PaletteButton({ entry }: { entry: PaletteEntry }) {
 *   const { dragHandleProps } = usePaletteDrag(entry.type);
 *   return <button {...dragHandleProps}>{entry.label}</button>;
 * }
 * ```
 */
export function usePaletteDrag(type: string): PaletteDrag {
  const payload: DragPayload = useMemo(
    () => ({ source: "palette", blockType: type }),
    [type],
  );
  const { ref } = useDraggable({ id: paletteDraggableId(type), data: payload });

  const isDragging = useDragSessionState((session) => {
    const carrying = session?.getCarrying();
    return carrying?.source === "palette" && carrying.blockType === type;
  });
  // Only one entry can be in the air at a time, so the refusal needs no owner:
  // the entry that is being dragged is the entry it belongs to.
  const refused = useDragSessionState(isRefusing);
  const isRefused = isDragging && refused;

  return useMemo(
    () => ({ dragHandleProps: { ref }, isDragging, isRefused }),
    [ref, isDragging, isRefused],
  );
}
