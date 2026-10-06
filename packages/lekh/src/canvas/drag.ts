/**
 * What a drag is carrying.
 *
 * Held as dnd-kit `data` on the draggable, and read back by the Canvas when a
 * drop resolves. It never reaches a Consumer, and no dnd-kit type reaches one
 * either (ADR-0008).
 */
export type DragPayload =
  | { readonly source: "palette"; readonly blockType: string }
  | {
      readonly source: "canvas";
      readonly blockId: string;
      readonly blockType: string;
    };

/**
 * Whether a drag is carrying a Block out of the email rather than a new one
 * out of a palette.
 *
 * Asked by the Canvas to decide whether the drag preview applies. A palette
 * drag lifts the Consumer's own entry, in their own document, already wearing
 * their own styles — there is nothing a preview could add.
 */
export function isCanvasDrag(data: unknown): boolean {
  return readDragPayload(data)?.source === "canvas";
}

/** The id a palette entry's draggable is registered under. */
export function paletteDraggableId(type: string): string {
  return `palette:${type}`;
}

/** The id a Block's draggable is registered under. */
export function blockDraggableId(blockId: string): string {
  return `block:${blockId}`;
}

/** Read a drag payload back off a draggable, if it carries one of ours. */
export function readDragPayload(data: unknown): DragPayload | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  if (!("source" in data) || !("blockType" in data)) return undefined;

  const { source, blockType } = data;
  if (typeof blockType !== "string") return undefined;
  if (source === "palette") return { source: "palette", blockType };

  if (source === "canvas" && "blockId" in data) {
    const { blockId } = data;
    if (typeof blockId === "string") {
      return { source: "canvas", blockId, blockType };
    }
  }
  return undefined;
}
