"use client";

import { useCallback, useMemo, useRef } from "react";

import { useDragHandleRegistry } from "./handles";
import type { DragHandleProps } from "./palette";
import { isRefusing, useDragSessionState } from "./session";

/** What it takes to move one Block already in the email by a grip. */
export interface BlockDrag {
  readonly dragHandleProps: DragHandleProps;
  /** Whether this Block is the one being carried. */
  readonly isDragging: boolean;
  /**
   * Whether this Block's drag is currently over somewhere that will not take
   * it — so the grip that started it can say so too.
   *
   * False while the drag is merely off the Canvas, which is how an Author
   * abandons one rather than a refusal.
   */
  readonly isRefused: boolean;
}

/**
 * Make an element the drag handle for a Block already in the email.
 *
 * Spread the props onto a grip — in the selected Block's Chrome, or a row of
 * a layers panel — and the Block moves when the grip is dragged:
 *
 * ```tsx
 * function Selection({ block, rect }: BlockChromeProps) {
 *   const { dragHandleProps } = useBlockDrag(block.id);
 *   return <button aria-label="Move" {...dragHandleProps} />;
 * }
 * ```
 *
 * Registering a handle is the whole opt-in, and it is for the whole editor.
 * While any Block has one, a press on any Block's body selects it and starts
 * no drag; a handle is the only way to pick a Block up (ADR-0043). With no
 * handle registered, every Block drags from its body, as it always has. The
 * handle is withdrawn when its element unmounts, so a grip drawn only for the
 * selected Block makes every Block grip-only while something is selected.
 *
 * No second draggable is made. The handle is handed to the Block's existing
 * one, so where a drop lands is resolved exactly as it is for a drag from the
 * body.
 */
export function useBlockDrag(blockId: string): BlockDrag {
  const registry = useDragHandleRegistry();
  const withdraw = useRef<(() => void) | undefined>(undefined);

  const ref = useCallback(
    (element: HTMLElement | null) => {
      withdraw.current?.();
      withdraw.current =
        element && registry ? registry.register(blockId, element) : undefined;
    },
    [registry, blockId],
  );

  // Read off the session rather than the backend's operation, which keeps its
  // source around after the drop.
  const isDragging = useDragSessionState((session) => {
    const carrying = session?.getCarrying();
    return carrying?.source === "canvas" && carrying.blockId === blockId;
  });

  // Only one Block can be in the air at a time, so the refusal needs no owner.
  const refused = useDragSessionState(isRefusing);
  const isRefused = isDragging && refused;

  return useMemo(
    () => ({ dragHandleProps: { ref }, isDragging, isRefused }),
    [ref, isDragging, isRefused],
  );
}
