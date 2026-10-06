import type { PointerEvent as ReactPointerEvent } from "react";

/**
 * Drag a handle: `move` hears how far the pointer has travelled, in the
 * page's pixels, the release commits, and Escape cancels.
 */
export function dragFrom(
  event: ReactPointerEvent<HTMLElement>,
  on: {
    readonly move: (dx: number, dy: number) => void;
    readonly commit: () => void;
    readonly cancel: () => void;
  },
): void {
  const from = { x: event.clientX, y: event.clientY };
  const handle = event.currentTarget;
  // Captured, or the drag dies the moment the pointer crosses into the frame.
  handle.setPointerCapture(event.pointerId);

  const stop = (): void => {
    handle.removeEventListener("pointermove", onMove);
    handle.removeEventListener("pointerup", onEnd);
    handle.removeEventListener("pointercancel", onEnd);
    window.removeEventListener("keydown", onKey, true);
  };
  const onMove = (moved: PointerEvent): void => {
    on.move(moved.clientX - from.x, moved.clientY - from.y);
  };
  const onEnd = (ended: PointerEvent): void => {
    stop();
    if (ended.type === "pointercancel") on.cancel();
    else on.commit();
  };
  const onKey = (pressed: KeyboardEvent): void => {
    if (pressed.key !== "Escape") return;
    pressed.preventDefault();
    pressed.stopPropagation();
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
    stop();
    on.cancel();
  };

  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", onEnd);
  handle.addEventListener("pointercancel", onEnd);
  window.addEventListener("keydown", onKey, true);
}
