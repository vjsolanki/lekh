import type { ControlDescriptor, Editor } from "lekh-editor";

/** Is this Box locked? Only when every side reads the same. */
export function isLocked(sides: readonly ControlDescriptor[]): boolean {
  return sides.every((side) => Object.is(side.value, sides[0]?.value));
}

/** Give every side one value, as one undo step. */
export function lockAt(
  editor: Editor,
  sides: readonly ControlDescriptor[],
  value: number,
): void {
  const blockId = sides[0]?.blockId;
  if (blockId === undefined) return;
  const values = Object.fromEntries(sides.map((side) => [side.name, value]));
  if (editor.setPendingChange(blockId, values)) editor.commitPendingChange();
}

/** On mobile, drop every side's phone-only value, as one undo step. */
export function useDesktop(
  editor: Editor,
  sides: readonly ControlDescriptor[],
): void {
  const blockId = sides[0]?.blockId;
  if (blockId === undefined) return;
  editor.clearMobileOverride(
    blockId,
    sides.map((side) => side.name),
  );
}
