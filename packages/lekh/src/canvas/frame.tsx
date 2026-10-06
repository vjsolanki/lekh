"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";

/**
 * The Consumer's application stylesheet must not reach the email, and media
 * queries must resolve against the Canvas rather than the browser window
 * (ADR-0003). Only the two margins every browser adds are reset.
 *
 * The root is taken out of flow so that it reports its own height honestly. In
 * flow it is never described as shorter than the viewport it sits in, so a
 * frame sized from it could only ever grow: an email that lost a Block would
 * keep the room the Block used to take, and one measured inside a tall frame
 * would simply report that frame's height back. Out of flow it is the height of
 * its content and nothing else, whatever the frame around it is doing.
 *
 * `width: 100%` because a box taken out of flow otherwise shrinks to fit, and
 * the frame's width is the whole point of it (ADR-0003) — the email must still
 * lay out against the Stage's width and resolve its media queries there.
 *
 * `:root` rather than `html`, because the two are not the same selector here. A
 * root Block that emits a whole email document renders an `<html>` element of
 * its own, and on React 18 that element is a real child of the frame's body
 * rather than the frame's own root. `html` would match it, take the entire
 * email out of flow inside the body, and leave the frame's actual root — the
 * thing the height is measured from — reporting nothing at all. `:root` matches
 * only the document's own root element, which is the one this is about.
 */
const FRAME_RESET =
  ":root,body{margin:0;padding:0}" +
  ":root{position:absolute;top:0;left:0;width:100%}";

export interface CanvasFrameProps {
  readonly title: string;
  readonly frameRef: Ref<HTMLIFrameElement>;
  /**
   * How wide the email is laid out: the Stage's true width, whatever the zoom.
   * Any CSS length, measured against the box the frame is drawn in.
   */
  readonly layoutWidth: string;
  /** How much larger the frame is drawn than it is laid out (ADR-0039). */
  readonly zoom: number;
  /** Called with the iframe's document once it exists, and again if it is replaced. */
  readonly onDocumentChange: (document: Document | null) => void;
  readonly children: ReactNode;
}

/**
 * A same-origin iframe with the Document portalled into it.
 *
 * A portal rather than a second React root, so the Consumer's context — theme,
 * store, anything a Block Definition's render function reads — reaches Blocks
 * inside the frame exactly as it would outside.
 *
 * The portal lands in the frame's `<body>`. A root Block that emits a whole
 * email document renders and behaves correctly there — `<head>` is hidden,
 * injected styles still apply, and media queries resolve against the frame —
 * but React's development build notes the nesting in the console. The
 * alternative, portalling into the document node, would break every root Block
 * that emits ordinary markup, so the note is the cheaper cost.
 */
export function CanvasFrame({
  title,
  frameRef,
  layoutWidth,
  zoom,
  onDocumentChange,
  children,
}: CanvasFrameProps): ReactNode {
  const [body, setBody] = useState<HTMLElement | null>(null);
  const element = useRef<HTMLIFrameElement | null>(null);
  const notify = useRef(onDocumentChange);
  notify.current = onDocumentChange;

  useEffect(() => {
    const frame = element.current;
    if (!frame) return undefined;

    const attach = (): void => {
      const document = frame.contentDocument;
      if (!document?.body) return;

      if (!document.querySelector("style[data-canvas-reset]")) {
        const style = document.createElement("style");
        style.dataset["canvasReset"] = "true";
        style.textContent = FRAME_RESET;
        document.head.append(style);
      }
      setBody(document.body);
      notify.current(document);
    };

    // An `about:blank` frame has a document immediately in some browsers and
    // only after `load` in others, so both are handled.
    attach();
    frame.addEventListener("load", attach);
    return () => {
      frame.removeEventListener("load", attach);
      notify.current(null);
    };
  }, []);

  /**
   * Size the frame to its content, so that it is not a scroll container.
   *
   * This is what keeps the Chrome welded to the email. Chrome is drawn in the
   * parent document and positioned from rectangles measured inside the frame;
   * if the frame scrolls internally, those rectangles move without the Chrome
   * moving, and only JavaScript running after the scroll has already painted
   * can put them back. With the frame as tall as its content there is one
   * scroller — the Consumer's — and it moves the email and the Chrome in the
   * same compositor frame, so the rectangles never change at all.
   *
   * `documentElement` rather than `body`, for the reason ADR-0003 gives: a root
   * Block may emit a whole email document, and `body` is then the height of the
   * viewport whatever the email inside it does.
   *
   * Written straight to the element rather than held in state. A height that
   * went through React would re-render the portal — rebuilding the whole email
   * tree — every time an image finished loading.
   *
   * Which is also why `height` is absent from the `style` prop below. React
   * only writes the style properties it is given, so leaving it out is what
   * makes this the sole owner of the frame's height.
   *
   * A zoomed frame gets a bottom margin the same way, which makes up the
   * difference between the height it is laid out at and the height it is
   * drawn at. A transform leaves layout alone, so without it the Canvas would
   * keep the room of the unscaled email (ADR-0039).
   */
  useLayoutEffect(() => {
    const frame = element.current;
    const view = body?.ownerDocument.defaultView;
    if (!frame || !view) return undefined;

    const root = view.document.documentElement;

    const size = (): void => {
      // Rounded up: a fractional content height left as a fraction leaves the
      // frame a sliver short, and a sliver short is a scrollbar.
      const content = Math.ceil(root.getBoundingClientRect().height);
      const height = `${String(content)}px`;
      const margin = zoom === 1 ? "" : `${String(content * (zoom - 1))}px`;
      if (frame.style.height !== height) frame.style.height = height;
      if (frame.style.marginBottom !== margin) {
        frame.style.marginBottom = margin;
      }
    };

    // Once up front: the frame is its default 150px until told otherwise, and
    // an observation is not guaranteed before the first paint.
    size();
    // The root is out of flow, so its height is its content's and changing the
    // frame around it changes nothing here. That is what makes one observation
    // enough for everything — a Block added or removed, a Text Engine mounting
    // its surface, an image reaching its intrinsic size, a font arriving — and
    // what keeps this from feeding itself.
    const observer = new view.ResizeObserver(size);
    observer.observe(root);

    return () => {
      observer.disconnect();
    };
  }, [body, zoom]);

  return (
    // Deliberately unsandboxed. The Canvas needs the frame to be same-origin —
    // that is what the portal, every measurement and cross-document pointer
    // capture depend on (ADR-0003) — and a sandbox that grants both
    // `allow-same-origin` and the scripting the drag backend needs restricts
    // nothing a Consumer's own document is not already exposed to. The frame
    // isolates CSS and the viewport, which is what ADR-0003 asks of it; it is
    // not a security boundary, and pretending otherwise would be worse.
    //
    // Laid out at the Stage's width and scaled from its top-left corner, so
    // the email's media queries still resolve against the width it is sent at.
    // oxlint-disable-next-line react/iframe-missing-sandbox
    <iframe
      title={title}
      ref={(node) => {
        element.current = node;
        assignRef(frameRef, node);
      }}
      style={{
        display: "block",
        width: layoutWidth,
        border: "none",
        ...(zoom === 1
          ? {}
          : { transform: `scale(${String(zoom)})`, transformOrigin: "0 0" }),
      }}
    >
      {body === null ? null : createPortal(children, body)}
    </iframe>
  );
}

function assignRef<T>(ref: Ref<T>, value: T | null): void {
  if (typeof ref === "function") ref(value);
  else if (ref !== null) ref.current = value;
}
