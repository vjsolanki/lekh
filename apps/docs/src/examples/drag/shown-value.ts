import { useCallback, useSyncExternalStore } from "react";
import type { ControlDescriptor } from "lekh";
import { useEditor } from "lekh/canvas";

/**
 * The value the Canvas shows for this control: the one being dragged, or the
 * saved one when no drag on it is open.
 *
 * `control.value` stays the saved value for the whole drag. A control that
 * should follow the pointer reads this instead. It also lets go by itself when
 * something else ends the drag, like a click on another Block.
 */
export function useShownValue(control: ControlDescriptor): unknown {
  const editor = useEditor();
  const subscribe = useCallback(
    (onChange: () => void) => editor.subscribeToPendingChange(onChange),
    [editor],
  );
  const read = () =>
    editor
      .getPendingChange()
      ?.ops.find(
        (op) => op.blockId === control.blockId && op.prop === control.name,
      )?.value;
  return useSyncExternalStore(subscribe, read, read) ?? control.value;
}
