import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useEditorState } from "lekh-editor/canvas";

/**
 * A strip above the selected row, one segment per column, with a grip on the
 * right edge of each one but the last.
 *
 * `share.preview` moves the real columns on the Canvas and returns every
 * width, so the strip draws the same split. `share.commit` stores both widths
 * as one undo step on release.
 */
export function ColumnStrip() {
  const division = useEditorState((editor) => editor.getDivision());
  const track = useRef<HTMLDivElement>(null);
  const [dragged, setDragged] = useState<readonly number[]>();

  if (!division) return null;
  const widths = dragged ?? division.shares.map((share) => share.width);

  const start = (index: number) => (event: ReactPointerEvent<HTMLElement>) => {
    const share = division.shares[index];
    const span = track.current?.getBoundingClientRect().width ?? 0;
    if (share === undefined || span <= 0) return;

    const from = event.clientX;
    const handle = event.currentTarget;
    // Without capture, the drag stops as soon as the pointer is over the
    // Canvas, which is an iframe.
    handle.setPointerCapture(event.pointerId);

    const move = (moved: PointerEvent) => {
      const delta = ((moved.clientX - from) / span) * 100;
      setDragged(share.preview(share.width + delta));
    };
    const end = (ended: PointerEvent) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      setDragged(undefined);
      // A pointer the browser took away is not a release.
      if (ended.type === "pointercancel") share.cancel();
      else share.commit();
    };

    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };

  return (
    <div ref={track} style={{ display: "flex" }}>
      {widths.map((width, index) => (
        <div
          key={division.shares[index]?.blockId ?? index}
          style={{ width: `${width}%`, display: "flex" }}
        >
          <span style={{ flex: 1 }}>{Math.round(width)}%</span>
          {index < widths.length - 1 ? (
            <span
              role="separator"
              style={{ width: 6, cursor: "col-resize" }}
              onPointerDown={start(index)}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}
