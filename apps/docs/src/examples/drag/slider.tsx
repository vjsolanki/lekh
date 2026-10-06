import { useRef } from "react";
import { Slider } from "radix-ui";
import type { ControlDescriptor } from "lekh-editor";
import { useShownValue } from "./shown-value";

/**
 * A Radix slider whose drag is one undo step, and whose arrow keys fold.
 *
 * `onValueChange` previews, but only while a pointer is down. On a key press,
 * Radix calls `onValueCommit` first and `onValueChange` after it. A preview
 * there would open a new drag after every key, and each would be its own
 * undo step.
 *
 * The release commits in `onPointerUp`. Radix skips `onValueCommit` when a
 * drag ends where it began, and the drag would stay open.
 */
export function NumberSlider({ control }: { control: ControlDescriptor }) {
  const value = useShownValue(control);
  const pointerDown = useRef(false);

  return (
    <Slider.Root
      // Radix commits the value it was given, so give it the dragged one.
      value={[typeof value === "number" ? value : 0]}
      min={0}
      max={64}
      onPointerDown={() => {
        pointerDown.current = true;
      }}
      onPointerUp={() => {
        pointerDown.current = false;
        control.commit();
      }}
      onValueChange={([next]) => {
        if (pointerDown.current && next !== undefined) control.preview(next);
      }}
      // One key press, or the end of a drag that `onPointerUp` has already
      // committed. With nothing pending, `commit(next)` is `set(next)`, so
      // quick presses are one undo step, and the same value again is nothing.
      onValueCommit={([next]) => {
        if (next !== undefined) control.commit(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") control.cancel();
      }}
    >
      <Slider.Track>
        <Slider.Range />
      </Slider.Track>
      <Slider.Thumb aria-label={control.label} />
    </Slider.Root>
  );
}
