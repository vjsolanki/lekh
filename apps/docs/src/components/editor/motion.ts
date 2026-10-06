import { useEffect, type RefObject } from "react";

import type { Action, Editor } from "lekh";

/** Where a Block's element sat, in the frame's own document coordinates. */
interface Place {
  readonly x: number;
  readonly y: number;
}

/** The editor's tokens, read once from its stylesheet. WAAPI cannot read `var()`. */
function tokens(): {
  ease: string;
  land: number;
  panel: number;
  primary: string;
} {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string): string => style.getPropertyValue(name).trim();
  const ms = (name: string): number => Number(read(name).replace(/ms$/u, ""));
  return {
    ease: read("--ease") || "cubic-bezier(0.2, 0, 0, 1)",
    land: ms("--duration-land") || 150,
    panel: ms("--duration-panel") || 200,
    primary: read("--primary") || "#2ea44f",
  };
}

/**
 * A short wash of the accent behind an Inspector field, for the one a status
 * bar check just jumped to. Full for a moment, then gone, like the Block wash.
 */
export function washField(element: HTMLElement): void {
  const { ease, land, panel, primary } = tokens();
  element.animate(
    [
      { backgroundColor: `color-mix(in srgb, ${primary} 16%, transparent)` },
      { backgroundColor: "transparent" },
    ],
    { duration: panel, delay: land, easing: ease, fill: "backwards" },
  );
}

function reducedMotion(): boolean {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function blockElements(frame: Document): readonly HTMLElement[] {
  return [...frame.querySelectorAll<HTMLElement>("[data-block-id]")];
}

function placesIn(frame: Document): Map<string, Place> {
  const view = frame.defaultView;
  const places = new Map<string, Place>();
  for (const element of blockElements(frame)) {
    const id = element.dataset.blockId;
    if (id === undefined || places.has(id)) continue;
    const rect = element.getBoundingClientRect();
    places.set(id, {
      x: rect.left + (view?.scrollX ?? 0),
      y: rect.top + (view?.scrollY ?? 0),
    });
  }
  return places;
}

/**
 * A short wash of the accent over a Block, drawn in the frame over the email.
 *
 * Laid over the Block rather than painted on it, so the email's own styles are
 * never touched. Full for a moment, then gone over the panel duration. A colour
 * change, not a movement, so it stays under reduced motion too.
 */
function wash(frame: Document, blockId: string, strength: number): void {
  const element = frame.querySelector(
    `[data-block-id="${CSS.escape(blockId)}"]`,
  );
  const view = frame.defaultView;
  if (!element || !view) return;
  const { ease, land, panel, primary } = tokens();
  const rect = element.getBoundingClientRect();
  const layer = frame.createElement("div");
  Object.assign(layer.style, {
    position: "absolute",
    top: `${String(rect.top + view.scrollY)}px`,
    left: `${String(rect.left + view.scrollX)}px`,
    width: `${String(rect.width)}px`,
    height: `${String(rect.height)}px`,
    borderRadius: "3px",
    background: `color-mix(in srgb, ${primary} ${String(strength)}%, transparent)`,
    pointerEvents: "none",
    zIndex: "2147483647",
  });
  frame.body.append(layer);
  const fading = layer.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: panel,
    delay: land,
    easing: ease,
    fill: "backwards",
  });
  const done = (): void => {
    layer.remove();
  };
  fading.addEventListener("finish", done);
  fading.addEventListener("cancel", done);
}

/**
 * Slide every Block that moved from where it was, all on one clock, so the
 * siblings of a dropped Block step aside together.
 *
 * A Block inside one that moved is carried by it, so only the outermost moving
 * Block of each branch is animated. Animating both would move the inner one
 * twice.
 */
function slide(
  frame: Document,
  before: ReadonlyMap<string, Place>,
  after: ReadonlyMap<string, Place>,
): void {
  const { ease, land } = tokens();
  const offset = (id: string | undefined): Place | undefined =>
    id === undefined ? undefined : movedBy(id, before, after);
  for (const element of blockElements(frame)) {
    const moved = offset(element.dataset.blockId);
    if (!moved) continue;
    const holder =
      element.parentElement?.closest<HTMLElement>("[data-block-id]");
    if (offset(holder?.dataset.blockId)) continue;
    element.animate(
      [
        { transform: `translate(${String(moved.x)}px, ${String(moved.y)}px)` },
        { transform: "none" },
      ],
      { duration: land, easing: ease },
    );
  }
}

/** How far a Block moved between two readings, or nothing if it stayed. */
function movedBy(
  blockId: string,
  before: ReadonlyMap<string, Place>,
  after: ReadonlyMap<string, Place>,
): Place | undefined {
  const was = before.get(blockId);
  const is = after.get(blockId);
  if (!was || !is) return undefined;
  const x = was.x - is.x;
  const y = was.y - is.y;
  return Math.abs(x) < 0.5 && Math.abs(y) < 0.5 ? undefined : { x, y };
}

/** What to show for an Action, now the frame has drawn it. */
function show(
  frame: Document,
  action: Action,
  before: ReadonlyMap<string, Place>,
  after: ReadonlyMap<string, Place>,
): void {
  if (action.via === "history") {
    for (const blockId of action.blocks) wash(frame, blockId, 16);
    return;
  }
  // A drop: the pointer let go and something landed or moved.
  if (action.via === "pointer" && action.blocks.length > 0) {
    // Washed before the slide starts: a sliding Block measures where it is
    // sliding from, and the wash belongs where it landed.
    const landed = action.inserted.length > 0 ? action.inserted : action.blocks;
    for (const blockId of landed) wash(frame, blockId, 22);
    if (!reducedMotion()) slide(frame, before, after);
    return;
  }
  // Move up, Move down and Move to…: the Block an Author sent somewhere. Only
  // a Block that changed place washes, so a duplicate or a change to its
  // props stays quiet.
  if (action.via === "command") {
    const moved = action.blocks.filter(
      (blockId) =>
        !action.inserted.includes(blockId) &&
        movedBy(blockId, before, after) !== undefined,
    );
    if (moved.length === 0) return;
    for (const blockId of moved) wash(frame, blockId, 22);
    if (!reducedMotion()) slide(frame, before, after);
  }
}

/**
 * Motion that says where things went, driven by the last Action.
 *
 * After an undo or a redo, the Blocks it changed get a short wash. After a
 * drop, or a Command that moves a Block, the Blocks it pushed aside slide from
 * where they were, and the Block that landed gets a green wash. Anything else,
 * a Layers row, a peer's change or a call from code, is drawn at once.
 *
 * Where each Block sat is kept from the last time, and again whenever a press
 * starts, so a window resize in between cannot make the slide start somewhere
 * the Block never was.
 */
export function useActionMotion(
  editor: Editor,
  stage: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const frameDocument = (): Document | undefined =>
      stage.current?.querySelector("iframe")?.contentDocument ?? undefined;

    let places = new Map<string, Place>();
    // The frame's document comes and goes with the Canvas, so its press
    // listener follows it rather than being set once.
    let listening: Document | undefined;
    const remember = (): void => {
      const frame = frameDocument();
      if (!frame) return;
      places = placesIn(frame);
      if (listening === frame) return;
      listening?.removeEventListener("pointerdown", remember, true);
      frame.addEventListener("pointerdown", remember, true);
      listening = frame;
    };
    remember();

    let pending = 0;
    const unsubscribe = editor.subscribe(() => {
      const action = editor.getLastAction();
      if (!action) return;
      cancelAnimationFrame(pending);
      // A frame on, once the Canvas has drawn the change and before it paints.
      pending = requestAnimationFrame(() => {
        const frame = frameDocument();
        if (!frame) return;
        const before = places;
        remember();
        show(frame, action, before, places);
      });
    });

    // A press in the frame or the page starts every drag.
    document.addEventListener("pointerdown", remember, true);
    return () => {
      unsubscribe();
      cancelAnimationFrame(pending);
      document.removeEventListener("pointerdown", remember, true);
      listening?.removeEventListener("pointerdown", remember, true);
    };
  }, [editor, stage]);
}
