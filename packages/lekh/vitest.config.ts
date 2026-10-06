import { playwright } from "@vitest/browser-playwright";
import type { BrowserCommand, BrowserCommandContext } from "vitest/node";
import { defineConfig } from "vitest/config";

interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Drive a real pointer through a path.
 *
 * Synthetic `PointerEvent`s cannot stand in here: dnd-kit calls
 * `setPointerCapture` on activation, which throws for a pointer id the browser
 * never issued, and a drag that fails to capture is cancelled. So the drag
 * tests ask the browser itself to move the mouse.
 *
 * Coordinates are in the test document's space. The tester runs in a frame
 * that is both offset within the page and painted smaller than its own
 * viewport, so a point is scaled and then shifted before the mouse is sent to
 * it. Without the scale every drag lands progressively further from where the
 * test aimed the further down the page it aims — which is how a drag onto the
 * top half of a Block arrives on its bottom half and the test quietly asserts
 * the wrong thing.
 */
/**
 * Where a point in the test document lands on the page.
 *
 * The tester runs in a frame that is both offset within the page and painted
 * smaller than its own viewport, so a point is scaled and then shifted before
 * the mouse is sent to it. Without the scale every drag lands progressively
 * further from where the test aimed the further down the page it aims — which
 * is how a drag onto the top half of a Block arrives on its bottom half and the
 * test quietly asserts the wrong thing.
 */
async function pageMapper(
  context: BrowserCommandContext,
): Promise<(point: Point) => readonly [number, number]> {
  if (context.provider.name !== "playwright") {
    throw new Error("The drag commands need the playwright provider.");
  }

  const frame = await context.frame();
  const frameElement = await frame.frameElement();
  const box = await frameElement.boundingBox();
  const viewport = await frame.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  const originX = box?.x ?? 0;
  const originY = box?.y ?? 0;
  const scaleX = box && viewport.width > 0 ? box.width / viewport.width : 1;
  const scaleY = box && viewport.height > 0 ? box.height / viewport.height : 1;
  return (point) => [originX + point.x * scaleX, originY + point.y * scaleY];
}

/**
 * Press, then follow a path. The button is left down.
 *
 * dnd-kit reads a pointer's velocity across moves, so every step is sent
 * separately rather than as one jump.
 */
async function tracePath(
  context: BrowserCommandContext,
  path: readonly Point[],
): Promise<void> {
  const inPage = await pageMapper(context);
  const [start, ...rest] = path;
  if (!start) throw new Error("A drag needs at least one point.");

  const { mouse } = context.page;
  await mouse.move(...inPage(start));
  await mouse.down();
  for (const point of rest) {
    await mouse.move(...inPage(point), { steps: 4 });
  }
}

/**
 * Drive a real pointer through a path and let go at the end.
 *
 * Synthetic `PointerEvent`s cannot stand in here: dnd-kit calls
 * `setPointerCapture` on activation, which throws for a pointer id the browser
 * never issued, and a drag that fails to capture is cancelled. So the drag
 * tests ask the browser itself to move the mouse.
 *
 * Coordinates are in the test document's space.
 */
const dragPointer: BrowserCommand<[readonly Point[]]> = async (
  context,
  path,
) => {
  await tracePath(context, path);
  await context.page.mouse.up();
};

/**
 * The same, but stopping with the Block still in the air.
 *
 * A drag looks different halfway through than it does at either end — a
 * preview is following the pointer outside the frame, and the Canvas is
 * drawing an answer to "where would this land". None of that can be asserted
 * by a gesture that runs to completion in one call. Release it with
 * `releasePointer`.
 */
const holdPointer: BrowserCommand<[readonly Point[]]> = async (
  context,
  path,
) => {
  await tracePath(context, path);
};

/**
 * Move a pointer already held down by `holdPointer` along a path, without
 * pressing or letting go — a drag that carries on in the air.
 */
const movePointer: BrowserCommand<[readonly Point[]]> = async (
  context,
  path,
) => {
  const inPage = await pageMapper(context);
  for (const point of path) {
    await context.page.mouse.move(...inPage(point), { steps: 4 });
  }
};

/** Let go of a drag left in the air by `holdPointer`. */
const releasePointer: BrowserCommand = async (context) => {
  await context.page.mouse.up();
};

/**
 * Double-click a point — the gesture that asks for a Block's text.
 *
 * Sent by the browser rather than dispatched, because the interesting half is
 * what the browser does of its own accord: it selects the word under the
 * pointer, and the caret the adapter takes is the one that leaves.
 */
const doubleClickPointer: BrowserCommand<[Point]> = async (context, point) => {
  const inPage = await pageMapper(context);
  await context.page.mouse.dblclick(...inPage(point));
};

export default defineConfig({
  test: {
    projects: [
      {
        // Everything that runs without a DOM: the editor instance and the
        // render path, plus the pure parts of the Canvas.
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: ["src/**/*.browser.test.tsx"],
        },
      },
      {
        // The browser seam, kept deliberately thin. A DOM emulator is not
        // enough: it reports zeroed element rectangles, so drag geometry and
        // coordinate translation cannot be exercised in one.
        test: {
          name: "browser",
          include: ["src/**/*.browser.test.tsx"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            // Roomy enough that a Canvas and a palette both fit on screen:
            // a drag aimed outside the viewport lands nowhere.
            instances: [
              { browser: "chromium", viewport: { width: 1280, height: 800 } },
            ],
            commands: {
              dragPointer,
              holdPointer,
              movePointer,
              releasePointer,
              doubleClickPointer,
            },
          },
        },
      },
    ],
  },
});
