import { type RefObject, useEffect } from "react";

/**
 * The ring round the Block keyboard focus is on.
 *
 * Focus and selection can differ. The Canvas marks every Block in the frame
 * as a button for the drag, so Tab walks the email and can rest on a Block
 * that is not selected. The browser's own ring is thin and blue, and lost on a
 * photograph. This one is green with a gap. The selection is a line on the
 * Block's edge, so the two never read as one mark.
 *
 * Written into the frame, because the focused element is in it. A fixed
 * green: the email is paper in both themes.
 */
const RING =
  "[data-block-id]:focus-visible{outline:2px solid #2ea44f;outline-offset:3px}";

/**
 * Keep the ring's style in the Canvas frame under `stage`.
 *
 * The frame is looked up each time rather than once, and written again
 * whenever a frame under `stage` loads. A `load` does not bubble, so it is
 * heard on the way down.
 */
export function useFocusRing(stage: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = stage.current;
    if (!element) return undefined;
    const write = (): void => {
      const frameDocument =
        element.querySelector("iframe")?.contentDocument ?? undefined;
      if (
        !frameDocument?.head ||
        frameDocument.querySelector("style[data-focus-ring]")
      ) {
        return;
      }
      const style = frameDocument.createElement("style");
      style.dataset["focusRing"] = "true";
      style.textContent = RING;
      frameDocument.head.append(style);
    };
    write();
    element.addEventListener("load", write, true);
    return () => {
      element.removeEventListener("load", write, true);
    };
  }, [stage]);
}
