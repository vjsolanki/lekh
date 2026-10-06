import { useEffect, useRef } from "react";
import type { ControlDescriptor } from "lekh-editor";
import { useEditor } from "lekh-editor/canvas";
import { useShownValue } from "./shown-value";

const SIDES = [
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
] as const;

/**
 * One range input that moves all four sides of a Block's padding.
 *
 * `editor.setPendingChange` takes several props on one Block. They are one Pending
 * Change, so the release stores four Ops as one undo step. Hand it the
 * `paddingTop` control: its value stands for all four.
 */
export function LinkedPadding({ control }: { control: ControlDescriptor }) {
  const editor = useEditor();
  const value = useShownValue(control);
  const input = useRef<HTMLInputElement>(null);

  // The native `change` event: the end of a drag, or one arrow key. Each key
  // is a preview and a commit, so each is its own undo step.
  useEffect(() => {
    const element = input.current;
    if (!element) return undefined;
    const commit = () => {
      editor.commitPendingChange();
    };
    element.addEventListener("change", commit);
    return () => {
      element.removeEventListener("change", commit);
    };
  }, [editor]);

  return (
    <input
      ref={input}
      type="range"
      min={0}
      max={64}
      value={typeof value === "number" ? value : 0}
      onChange={(event) => {
        const next = event.target.valueAsNumber;
        editor.setPendingChange(
          control.blockId,
          Object.fromEntries(SIDES.map((side) => [side, next])),
        );
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") editor.cancelPendingChange();
      }}
    />
  );
}
