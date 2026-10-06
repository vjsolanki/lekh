import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { onTestFinished, vi } from "vitest";
import { commands, userEvent } from "vitest/browser";

/**
 * The browser seam's shared helpers: mount, wait for the Canvas, and aim a
 * real pointer.
 *
 * Browser tests only. Node tests cannot import this, because `vitest/browser`
 * exists only in the browser project.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** The custom commands defined in `vitest.config.ts`. */
declare module "vitest/internal/browser" {
  interface BrowserCommands {
    dragPointer: (this: void, path: readonly Point[]) => Promise<void>;
    holdPointer: (this: void, path: readonly Point[]) => Promise<void>;
    movePointer: (this: void, path: readonly Point[]) => Promise<void>;
    releasePointer: (this: void) => Promise<void>;
    doubleClickPointer: (this: void, point: Point) => Promise<void>;
  }
}

// Typed rather than inferred. Inferred, the type can point at another test
// file's copy of the declaration above, which the build cannot name.

/** Press, follow the path, and let go at its end. */
export const dragPointer: (path: readonly Point[]) => Promise<void> =
  commands.dragPointer;
/** Press and follow the path, leaving the button down. */
export const holdPointer: (path: readonly Point[]) => Promise<void> =
  commands.holdPointer;
/** Carry on a drag `holdPointer` left in the air, without letting go. */
export const movePointer: (path: readonly Point[]) => Promise<void> =
  commands.movePointer;
/** Let go of a drag `holdPointer` left in the air. */
export const releasePointer: () => Promise<void> = commands.releasePointer;
/** Double-click a point, the way the browser would. */
export const doubleClickPointer: (point: Point) => Promise<void> =
  commands.doubleClickPointer;

/**
 * Press a key the way an Author does, into whatever has focus, even inside
 * the frame. Written as `userEvent.keyboard` takes it: `"{Escape}"`.
 */
export async function pressKey(keys: string): Promise<void> {
  await userEvent.keyboard(keys);
}

/**
 * Where a mounted tree sits unless a test says otherwise: away from the
 * origin, so a translation that forgot the offset shows up rather than passing
 * by luck.
 */
const HOST_STYLE =
  "position:absolute; top:30px; left:50px; width:700px; height:400px;";

/**
 * Render a tree into a fresh host on the page and return the host.
 *
 * Unmounted and removed when the test finishes, so a test needs no
 * `afterEach` of its own.
 */
export function mount(
  ui: ReactNode,
  options: { readonly hostStyle?: string } = {},
): HTMLElement {
  const host = window.document.createElement("div");
  host.style.cssText = options.hostStyle ?? HOST_STYLE;
  window.document.body.append(host);
  const root = createRoot(host);
  root.render(ui);
  onTestFinished(() => {
    root.unmount();
    host.remove();
  });
  return host;
}

/** A Canvas that has rendered: its frame and the document inside it. */
export interface MountedCanvas {
  readonly frame: HTMLIFrameElement;
  readonly frameDocument: Document;
}

/** Wait until the frame exists in the host and a Block has rendered into it. */
export function whenRendered(host: HTMLElement): Promise<MountedCanvas> {
  return vi.waitFor(() => {
    const frame = host.querySelector("iframe");
    const frameDocument = frame?.contentDocument ?? undefined;
    if (!frame || !frameDocument?.querySelector("[data-block-id]")) {
      throw new Error("The Canvas has not rendered yet.");
    }
    return { frame, frameDocument };
  });
}

/** The element the Canvas drew for a Block. Throws when there is none. */
export function blockElement(mounted: MountedCanvas, blockId: string): Element {
  const element = mounted.frameDocument.querySelector(
    `[data-block-id="${blockId}"]`,
  );
  if (!element) throw new Error(`No element for Block ${blockId}.`);
  return element;
}

/**
 * Where a Block is drawn, in the test document's coordinates: measured inside
 * the frame, then scaled and moved by however the frame is drawn.
 */
export function drawnRectOf(mounted: MountedCanvas, blockId: string): DOMRect {
  const frame = mounted.frame.getBoundingClientRect();
  const block = blockElement(mounted, blockId).getBoundingClientRect();
  const scale = frame.width / mounted.frame.offsetWidth;
  return new DOMRect(
    frame.left + block.left * scale,
    frame.top + block.top * scale,
    block.width * scale,
    block.height * scale,
  );
}

/**
 * A point on a Block, in the test document's coordinates: across its middle,
 * and the given fraction of the way down.
 */
export function pointOnBlock(
  mounted: MountedCanvas,
  blockId: string,
  fractionDown: number,
): Point {
  const block = drawnRectOf(mounted, blockId);
  return {
    x: block.left + block.width / 2,
    y: block.top + block.height * fractionDown,
  };
}

/** The centre of a Block, in the test document's coordinates. */
export function centreOfBlock(mounted: MountedCanvas, blockId: string): Point {
  return pointOnBlock(mounted, blockId, 0.5);
}

/** The centre of an element in the test document itself. */
export function centreOf(element: Element): Point {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * A path with small first steps, the way a hand actually starts a drag.
 *
 * The end is repeated so the last move settles before the button is let go.
 */
export function pathBetween(from: Point, to: Point): readonly Point[] {
  return [
    from,
    { x: from.x + 3, y: from.y + 3 },
    { x: from.x + 8, y: from.y + 8 },
    { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
    to,
    to,
  ];
}

/**
 * Give a gesture that should have changed nothing the chance to change it.
 *
 * A drop is applied a frame after the drag ends, so a test asserting that the
 * email did not move has to let that frame run — otherwise it passes before
 * the code it is testing has had a turn.
 */
export async function afterAFrame(): Promise<void> {
  await new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve(undefined);
    });
  });
  await new Promise((resolve) => {
    setTimeout(resolve, 20);
  });
}
