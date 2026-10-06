import { describe, expect, it } from "vitest";

import {
  dropIndicatorRect,
  easeIn,
  edgeScrollSpeed,
  fromFrame,
  intoFrame,
  placementRect,
  toCanvasSpace,
  toCanvasSpacePoint,
  towardEdge,
  type Rect,
} from "./geometry";

/**
 * The Canvas renders the Document inside an iframe but draws every piece of
 * Chrome in the parent document, so a rectangle measured in one space has to
 * arrive in the other. Consumers never do this arithmetic, so it is pinned
 * here rather than left to the browser suite.
 */
describe("coordinate translation", () => {
  const canvas: Rect = { top: 100, left: 40, width: 640, height: 800 };
  const frame: Rect = { top: 120, left: 60, width: 600, height: 760 };

  it("translates a rectangle measured in the iframe into the Canvas's space", () => {
    const measured: Rect = { top: 10, left: 5, width: 200, height: 50 };

    expect(toCanvasSpace(measured, frame, canvas, 1)).toEqual({
      top: 30,
      left: 25,
      width: 200,
      height: 50,
    });
  });

  it("leaves a rectangle where it is when the iframe fills the Canvas", () => {
    const flush: Rect = { ...canvas };
    const measured: Rect = { top: 10, left: 5, width: 200, height: 50 };

    expect(toCanvasSpace(measured, flush, canvas, 1)).toEqual(measured);
  });

  it("translates a pointer position reported in the parent's viewport", () => {
    expect(toCanvasSpacePoint({ x: 240, y: 300 }, canvas)).toEqual({
      x: 200,
      y: 200,
    });
  });

  it("scales a rectangle measured in a zoomed frame to its drawn size", () => {
    const measured: Rect = { top: 10, left: 5, width: 200, height: 50 };

    expect(toCanvasSpace(measured, frame, canvas, 0.5)).toEqual({
      top: 25,
      left: 22.5,
      width: 100,
      height: 25,
    });
  });

  it("carries a point between a zoomed frame and the parent, both ways", () => {
    const inFrame = { x: 10, y: 40 };
    const inParent = fromFrame(inFrame, frame, 1.25);

    expect(inParent).toEqual({ x: 72.5, y: 170 });
    expect(intoFrame(inParent, frame, 1.25)).toEqual(inFrame);
  });
});

/**
 * The drop indicator's rectangle is derived from the resolved Drop Target, so
 * a Consumer positions their indicator without knowing which Block it relates
 * to or which way round the insertion goes.
 */
describe("the drop indicator rectangle", () => {
  const rects = new Map<string, Rect>([
    ["section", { top: 0, left: 0, width: 600, height: 300 }],
    ["text", { top: 40, left: 20, width: 560, height: 100 }],
  ]);

  it("sits along the top edge of the reference Block when inserting before it", () => {
    const rect = dropIndicatorRect(
      {
        parentId: "section",
        index: 0,
        position: "before",
        referenceBlockId: "text",
      },
      rects,
    );

    expect(rect).toEqual({ top: 40, left: 20, width: 560, height: 0 });
  });

  it("sits along the bottom edge when inserting after it", () => {
    const rect = dropIndicatorRect(
      {
        parentId: "section",
        index: 1,
        position: "after",
        referenceBlockId: "text",
      },
      rects,
    );

    expect(rect).toEqual({ top: 140, left: 20, width: 560, height: 0 });
  });

  it("runs down the left edge when inserting before a child sharing a line", () => {
    const rect = dropIndicatorRect(
      {
        parentId: "section",
        index: 0,
        position: "before",
        referenceBlockId: "text",
        axis: "horizontal",
      },
      rects,
    );

    expect(rect).toEqual({ top: 40, left: 20, width: 0, height: 100 });
  });

  it("runs down the right edge when inserting after one", () => {
    const rect = dropIndicatorRect(
      {
        parentId: "section",
        index: 1,
        position: "after",
        referenceBlockId: "text",
        axis: "horizontal",
      },
      rects,
    );

    expect(rect).toEqual({ top: 40, left: 580, width: 0, height: 100 });
  });

  it("covers the parent when the drop lands inside an empty container", () => {
    const rect = dropIndicatorRect(
      { parentId: "section", index: 0, position: "inside" },
      rects,
    );

    expect(rect).toEqual({ top: 0, left: 0, width: 600, height: 300 });
  });

  it("yields nothing when the Block it relates to was never measured", () => {
    const rect = dropIndicatorRect(
      {
        parentId: "section",
        index: 0,
        position: "before",
        referenceBlockId: "image",
      },
      rects,
    );

    expect(rect).toBeUndefined();
  });
});

/**
 * A pending image is Chrome with nothing behind it in the Document, so its
 * rectangle is derived from where the image is going rather than measured.
 */
describe("the pending image rectangle", () => {
  const rects = new Map<string, Rect>([
    ["section", { top: 0, left: 0, width: 600, height: 300 }],
    ["photo", { top: 40, left: 20, width: 560, height: 100 }],
  ]);

  it("covers the Block whose image is being changed", () => {
    expect(
      placementRect(
        { kind: "replace", blockId: "photo", prop: "asset", decorative: false },
        rects,
      ),
    ).toEqual({
      top: 40,
      left: 20,
      width: 560,
      height: 100,
    });
  });

  it("sits at the position the Block would take, since it is not there yet", () => {
    const rect = placementRect(
      {
        kind: "insert",
        type: "image",
        target: {
          parentId: "section",
          index: 1,
          position: "after",
          referenceBlockId: "photo",
        },
      },
      rects,
    );

    expect(rect).toEqual({ top: 140, left: 20, width: 560, height: 0 });
  });

  it("yields nothing for a Block that was never measured", () => {
    expect(
      placementRect(
        {
          kind: "replace",
          blockId: "missing",
          prop: "asset",
          decorative: false,
        },
        rects,
      ),
    ).toBeUndefined();
  });
});

/**
 * Carrying a Block to a position that is off-screen has to be one gesture, so
 * a drag near the Canvas's edge scrolls it.
 */
describe("edge scrolling", () => {
  const size = { width: 600, height: 400 };
  const zone = 50;
  const speed = 10;

  it("stays still while the pointer is away from both edges", () => {
    expect(edgeScrollSpeed({ x: 300, y: 200 }, size, zone, speed)).toBe(0);
    expect(edgeScrollSpeed({ x: 300, y: 50 }, size, zone, speed)).toBe(0);
    expect(edgeScrollSpeed({ x: 300, y: 350 }, size, zone, speed)).toBe(0);
  });

  it("scrolls towards the top of the email near the top edge", () => {
    expect(edgeScrollSpeed({ x: 300, y: 25 }, size, zone, speed)).toBe(-5);
    expect(edgeScrollSpeed({ x: 300, y: 0 }, size, zone, speed)).toBe(-10);
  });

  it("scrolls towards the end of the email near the bottom edge", () => {
    expect(edgeScrollSpeed({ x: 300, y: 375 }, size, zone, speed)).toBe(5);
    expect(edgeScrollSpeed({ x: 300, y: 400 }, size, zone, speed)).toBe(10);
  });

  it("runs at full speed once the pointer is past the edge", () => {
    expect(edgeScrollSpeed({ x: 300, y: -20 }, size, zone, speed)).toBe(-10);
    expect(edgeScrollSpeed({ x: 300, y: 420 }, size, zone, speed)).toBe(10);
  });

  it("stops once the drag has left the Canvas", () => {
    expect(edgeScrollSpeed({ x: -10, y: 10 }, size, zone, speed)).toBe(0);
    expect(edgeScrollSpeed({ x: 700, y: 390 }, size, zone, speed)).toBe(0);
    expect(edgeScrollSpeed({ x: 300, y: -80 }, size, zone, speed)).toBe(0);
    expect(edgeScrollSpeed({ x: 300, y: 480 }, size, zone, speed)).toBe(0);
  });
});

/**
 * A Block picked up near the edge must not scroll the email before the Author
 * has gone anywhere. The edge only counts once the pointer heads for it.
 */
describe("heading for the edge", () => {
  const start = { x: 300, y: 380 };

  it("does not scroll towards an edge the pointer has not moved towards", () => {
    expect(towardEdge(8, start, start)).toBe(0);
    expect(towardEdge(8, start, { x: 320, y: 370 })).toBe(0);
  });

  it("scrolls once the pointer has moved towards that edge", () => {
    expect(towardEdge(8, start, { x: 300, y: 390 })).toBe(8);
  });

  it("asks the same of the top edge", () => {
    const high = { x: 300, y: 20 };
    expect(towardEdge(-8, high, high)).toBe(0);
    expect(towardEdge(-8, high, { x: 300, y: 10 })).toBe(-8);
  });

  it("leaves a still Canvas still", () => {
    expect(towardEdge(0, start, { x: 300, y: 390 })).toBe(0);
  });
});

/**
 * Crossing the edge zone on the way to a gap near it should barely move the
 * email. Speed builds over 400ms, so only lingering runs.
 */
describe("easing into an edge scroll", () => {
  it("starts slow", () => {
    expect(easeIn(12, 0)).toBe(1);
    expect(easeIn(-12, 0)).toBe(-1);
  });

  it("is still short of full speed partway in", () => {
    expect(Math.abs(easeIn(12, 200))).toBeLessThan(12);
    expect(Math.abs(easeIn(12, 200))).toBeGreaterThan(1);
  });

  it("reaches full speed after 400ms and stays there", () => {
    expect(easeIn(12, 400)).toBe(12);
    expect(easeIn(-12, 2000)).toBe(-12);
  });

  it("leaves a still Canvas still", () => {
    expect(easeIn(0, 1000)).toBe(0);
  });
});
