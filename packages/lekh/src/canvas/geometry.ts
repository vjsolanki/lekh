import type { ImagePlacement } from "../core/document/assets";
import type { Point } from "../core/editor/drop-target";
import type { DropTarget } from "../core/editor/drop-target";

/**
 * A rectangle in the Canvas's own coordinate space.
 *
 * Every rectangle handed to a Slot is in this space: the top-left corner of
 * the Canvas element, in the parent document. Positioning Chrome is therefore
 * `position: absolute` plus these four numbers, with no arithmetic.
 */
export interface Rect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Translate a rectangle measured inside the iframe into the Canvas's space.
 *
 * `frame` and `canvas` are the iframe's and the Canvas element's rectangles as
 * the parent document sees them, so the difference between them is the offset
 * the iframe's own viewport introduces (ADR-0003). `zoom` is how much larger
 * the frame is drawn than it is laid out (ADR-0039), so a Slot gets the
 * rectangle at the size the Author sees.
 */
export function toCanvasSpace(
  rect: Rect,
  frame: Rect,
  canvas: Rect,
  zoom: number,
): Rect {
  return {
    top: rect.top * zoom + frame.top - canvas.top,
    left: rect.left * zoom + frame.left - canvas.left,
    width: rect.width * zoom,
    height: rect.height * zoom,
  };
}

/**
 * A point the frame reported in its own viewport, in the parent's.
 *
 * The frame's rectangle is where it is drawn, and `zoom` how much larger it is
 * drawn than laid out (ADR-0039).
 */
export function fromFrame(point: Point, frame: Rect, zoom: number): Point {
  return { x: frame.left + point.x * zoom, y: frame.top + point.y * zoom };
}

/** A point in the parent's viewport, in the frame's own. */
export function intoFrame(point: Point, frame: Rect, zoom: number): Point {
  return { x: (point.x - frame.left) / zoom, y: (point.y - frame.top) / zoom };
}

/** Translate a point reported in the parent's viewport into the same space. */
export function toCanvasSpacePoint(point: Point, canvas: Rect): Point {
  return { x: point.x - canvas.left, y: point.y - canvas.top };
}

/**
 * Where a Consumer's drop indicator belongs, given a resolved Drop Target.
 *
 * An insertion between Blocks is a degenerate rectangle along the edge the
 * Block will land on: a zero-height line under a stacked parent, and a
 * zero-width one down the side of a parent whose children share a line, so a
 * column dropped between two columns is shown landing between them rather
 * than above or below one. A drop inside an empty container is the container
 * itself. The Consumer draws whatever they like at that rectangle.
 */
export function dropIndicatorRect(
  target: DropTarget,
  rects: ReadonlyMap<string, Rect>,
): Rect | undefined {
  if (target.position === "inside") return rects.get(target.parentId);

  const reference =
    target.referenceBlockId === undefined
      ? undefined
      : rects.get(target.referenceBlockId);
  if (!reference) return undefined;

  const after = target.position === "after";
  if (target.axis === "horizontal") {
    return {
      top: reference.top,
      left: after ? reference.left + reference.width : reference.left,
      width: 0,
      height: reference.height,
    };
  }

  return {
    top: after ? reference.top + reference.height : reference.top,
    left: reference.left,
    width: reference.width,
    height: 0,
  };
}

/**
 * Where the Chrome for an outstanding image resolution belongs.
 *
 * A replacement sits over the Block whose image is changing; an insertion sits
 * at the position the Block will take once there is something to put in it —
 * the anticipated position, since nothing is in the Document yet.
 */
export function placementRect(
  placement: ImagePlacement,
  rects: ReadonlyMap<string, Rect>,
): Rect | undefined {
  return placement.kind === "replace"
    ? rects.get(placement.blockId)
    : dropIndicatorRect(placement.target, rects);
}

/**
 * How far the Canvas should scroll this frame, for a pointer near its edge.
 *
 * Negative scrolls towards the top of the email. The speed ramps with how deep
 * into the edge zone the pointer is, so nudging the edge creeps and pinning
 * the pointer against it runs — which is what lets an Author carry a Block to
 * a distant position in one gesture.
 *
 * Zero once the pointer leaves the Canvas sideways or clears the zone
 * vertically, so a drag heading for a palette does not drag the email with it.
 */
export function edgeScrollSpeed(
  pointer: Point,
  size: { readonly width: number; readonly height: number },
  zone: number,
  maxSpeed: number,
): number {
  if (zone <= 0 || size.height <= 0) return 0;
  if (pointer.x < 0 || pointer.x > size.width) return 0;
  if (pointer.y < -zone || pointer.y > size.height + zone) return 0;

  const depthFromTop = zone - pointer.y;
  if (depthFromTop > 0) return -ramp(depthFromTop, zone, maxSpeed);

  const depthFromBottom = zone - (size.height - pointer.y);
  if (depthFromBottom > 0) return ramp(depthFromBottom, zone, maxSpeed);

  return 0;
}

function ramp(depth: number, zone: number, maxSpeed: number): number {
  return Math.round((Math.min(depth, zone) / zone) * maxSpeed);
}

/**
 * An edge scroll, kept only once the pointer has moved towards that edge since
 * the drag started.
 *
 * A Block picked up near the bottom of the view starts inside the edge zone.
 * Scrolling then would move the email before the Author has gone anywhere, and
 * the place they meant to aim at would slide away.
 */
export function towardEdge(
  speed: number,
  start: Point,
  pointer: Point,
): number {
  if (speed < 0) return pointer.y < start.y ? speed : 0;
  if (speed > 0) return pointer.y > start.y ? speed : 0;
  return 0;
}

/** How long an edge scroll takes to build up to its full speed. */
export const EDGE_SCROLL_EASE_MS = 400;

/**
 * An edge scroll's speed, this long after it began.
 *
 * Builds up over {@link EDGE_SCROLL_EASE_MS}, so crossing the zone on the way
 * to a gap near the edge barely moves the email and only lingering runs. Never
 * below a pixel a frame: a scroll that has begun keeps going.
 */
export function easeIn(speed: number, elapsedMs: number): number {
  if (speed === 0) return 0;
  const progress = Math.min(Math.max(elapsedMs, 0) / EDGE_SCROLL_EASE_MS, 1);
  const eased = Math.round(Math.abs(speed) * progress * progress);
  return Math.sign(speed) * Math.max(eased, 1);
}

/** A `DOMRect` narrowed to the four numbers the Canvas uses. */
export function rectOf(rect: DOMRect): Rect {
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * The origin every Slot's rectangle is measured from.
 *
 * An absolutely positioned Slot is placed against its containing block, which
 * is the padding box — so a Consumer who puts a border on the Canvas would see
 * their Chrome sit a border-width out if the border box were used instead.
 */
export function paddingBoxOf(element: HTMLElement): Rect {
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top + element.clientTop,
    left: rect.left + element.clientLeft,
    width: element.clientWidth,
    height: element.clientHeight,
  };
}

/**
 * What moves the Canvas, and the box the Author is looking at it through.
 *
 * `viewport` is what can actually be seen, in the parent's viewport space. It
 * is deliberately not the Canvas: the Canvas is as tall as the email, so "48px
 * from its bottom edge" would mean 48px from the end of the whole email — true
 * of almost every drag, and nothing to do with whether the Author has run out
 * of room to aim at. The same box answers "is this Block on screen".
 */
export interface CanvasScroller {
  readonly viewport: Rect;
  readonly scrollBy: (x: number, y: number, behavior?: ScrollBehavior) => void;
}

/**
 * The scroller the Canvas sits in, whosever it is.
 *
 * The frame is sized to its content and scrolls nothing (ADR-0003), so
 * everything that wants to move the email — a drag carrying a Block past the
 * bottom edge, a reveal sending the Author to a Block off screen — has to move
 * whatever holds the overflow. That is the Consumer's element when they laid
 * one out and the Canvas's own wrapper when they asked for a height instead,
 * and walking up finds either without needing to know which. Falling back to
 * the window covers the ordinary case where the page itself scrolls, and gives
 * a sensible viewport even when nothing scrolls at all — so a Canvas with
 * nothing to scroll still takes its edges from the screen rather than from the
 * length of the email.
 */
export function scrollerOf(element: HTMLElement): CanvasScroller {
  const view = element.ownerDocument.defaultView;
  if (!view) {
    return {
      viewport: { top: 0, left: 0, width: 0, height: 0 },
      scrollBy: nothing,
    };
  }

  for (
    let node = element.parentElement;
    node !== null;
    node = node.parentElement
  ) {
    const overflow = view.getComputedStyle(node).overflowY;
    if (
      overflow === "auto" ||
      overflow === "scroll" ||
      overflow === "overlay"
    ) {
      return {
        viewport: paddingBoxOf(node),
        scrollBy: (x, y, behavior) => {
          node.scrollBy({ left: x, top: y, ...(behavior ? { behavior } : {}) });
        },
      };
    }
  }

  return {
    viewport: {
      top: 0,
      left: 0,
      width: view.innerWidth,
      height: view.innerHeight,
    },
    scrollBy: (x, y, behavior) => {
      view.scrollBy({ left: x, top: y, ...(behavior ? { behavior } : {}) });
    },
  };
}

function nothing(): void {
  return undefined;
}

/** Whether two measurements found the same thing in the same place. */
export function sameRect(a: Rect | undefined, b: Rect | undefined): boolean {
  if (!a || !b) return a === b;
  return (
    a.top === b.top &&
    a.left === b.left &&
    a.width === b.width &&
    a.height === b.height
  );
}

/** Whether two measurement passes found every Block in the same place. */
export function sameRects(
  a: ReadonlyMap<string, Rect>,
  b: ReadonlyMap<string, Rect>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [id, rect] of a) {
    if (!sameRect(rect, b.get(id))) return false;
  }
  return true;
}
