import { useEffect, useRef } from "react";
import type { ControlDescriptor } from "lekh";
import { useShownValue } from "./shown-value";

/**
 * A native colour input whose drag is one undo step.
 *
 * React's `onChange` is the native `input` event. It fires on every move of
 * the picker, so it previews. The native `change` event fires once, when the
 * picker lets go, and React has no prop for it. So it gets a listener of its
 * own, and that listener commits.
 */
export function ColorInput({ control }: { control: ControlDescriptor }) {
  const value = useShownValue(control);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const element = input.current;
    if (!element) return undefined;
    const commit = () => {
      control.commit();
    };
    element.addEventListener("change", commit);
    return () => {
      element.removeEventListener("change", commit);
    };
  }, [control]);

  return (
    <input
      ref={input}
      type="color"
      value={typeof value === "string" ? value : "#000000"}
      onChange={(event) => {
        control.preview(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") control.cancel();
      }}
    />
  );
}
