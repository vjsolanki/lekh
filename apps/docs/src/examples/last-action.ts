import type { Editor } from "lekh";

/**
 * Choose what to animate from how the last change came about. `flash` and
 * `glideSelection` are yours.
 */
export function animateActions(
  editor: Editor,
  flash: (blockIds: readonly string[]) => void,
  glideSelection: () => void,
): () => void {
  return editor.subscribe(() => {
    const action = editor.getLastAction();
    if (action?.via === "history") flash(action.blocks);
    if (action?.via === "pointer") glideSelection();
  });
}
