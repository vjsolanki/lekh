"use client";

import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
} from "react";

import { applyDrop, type Dropped } from "../core/editor/drop";
import type {
  BlockRect,
  DropOutcome,
  DropRefusal,
  DropTarget,
  Point,
} from "../core/editor/drop-target";
import { actVia, type Editor } from "../core/editor/editor";
import type { DragPayload } from "./drag";
import type { Rect } from "./geometry";

/**
 * What a drag is carrying: a Block out of the email, a new one out of a
 * palette, or an image file from the desktop, which lands as a Block of the
 * editor's image type.
 */
export type Carrying =
  DragPayload | { readonly source: "file"; readonly blockType: string };

/**
 * What the session needs from the Canvas, which is the only thing that can
 * answer it: the editor a drop lands in, where every Block is, how to tell the
 * Consumer a drop was turned down, and when the drag backend has let go of the
 * DOM.
 */
export interface SessionCanvas {
  readonly editor: Editor;
  /** Every measured Block, in the Canvas's own coordinate space. */
  readonly rects: () => ReadonlyMap<string, Rect>;
  readonly onRefused: (refusal: DropRefusal) => void;
  /** Run a change once the gesture has unwound. */
  readonly settle: (change: () => void) => void;
}

/**
 * The one drag in flight, from the moment it is picked up to the moment it
 * lands or is abandoned.
 *
 * A plain store with no React in it, like the Editor. The drag backend, a
 * native file drag and the Canvas's edge scroll all feed it; the Canvas, the
 * palette and a grip read it through selectors (ADR-0011).
 *
 * It works the Drop Target and the refusal out once per move, and wakes its
 * listeners only when one of them changes — so a pointer that moves within the
 * same gap re-renders nothing. Refusals are compared by value, because each
 * resolution builds a new one.
 *
 * Never saved. The Document is state an Author is editing; this is state that
 * exists for the length of a gesture.
 */
export interface DragSession {
  start: (carrying: Carrying) => void;
  /** Follow the pointer, in the Canvas's coordinate space. */
  move: (pointer: Point) => void;
  /**
   * Let go. Resolves where the pointer was released, and applies the drop.
   * `files` is what a file drag turned out to carry, which a browser only
   * hands over at the drop.
   */
  drop: (pointer: Point | undefined, files?: readonly File[]) => void;
  /** Abandon the drag. Nothing lands and nothing is reported. */
  cancel: () => void;

  getCarrying: () => Carrying | undefined;
  getDropTarget: () => DropTarget | undefined;
  getRefusal: () => DropRefusal | undefined;
  /** Where the pointer last was, in Canvas space. */
  getPointer: () => Point | undefined;

  /** Hear the Drop Target, the refusal or what is carried change. */
  subscribe: (listener: () => void) => () => void;
  /**
   * Hear the pointer move, while a refusal is met. The refusal is drawn at
   * the pointer, and nothing else needs to follow it.
   */
  subscribeToPointer: (listener: () => void) => () => void;

  /**
   * Give the session its Canvas. The returned function takes it back, and
   * abandons a drag still in the air: with no Canvas there is nowhere for it
   * to land.
   */
  attach: (canvas: SessionCanvas) => () => void;
}

const ELSEWHERE: DropOutcome = { status: "elsewhere" };

export function createDragSession(): DragSession {
  let canvas: SessionCanvas | undefined;
  let carrying: Carrying | undefined;
  let dropTarget: DropTarget | undefined;
  let refusal: DropRefusal | undefined;
  let pointer: Point | undefined;

  const listeners = new Set<() => void>();
  const pointerListeners = new Set<() => void>();

  const resolve = (at: Point): DropOutcome => {
    if (!carrying || !canvas) return ELSEWHERE;
    return canvas.editor.resolveDropTarget({
      draggedType: carrying.blockType,
      pointer: at,
      rects: blockRectsOf(canvas.rects()),
      ...(carrying.source === "canvas"
        ? { draggedBlockId: carrying.blockId }
        : {}),
    });
  };

  const reset = (next: Carrying | undefined): void => {
    carrying = next;
    dropTarget = undefined;
    refusal = undefined;
    pointer = undefined;
    notify(listeners);
  };

  const end = (): void => {
    if (carrying) reset(undefined);
  };

  return {
    start: reset,

    move(at) {
      if (!carrying) return;
      pointer = at;
      const outcome = resolve(at);
      const nextTarget =
        outcome.status === "landing" ? outcome.target : undefined;
      const nextRefusal =
        outcome.status === "refused" ? outcome.refusal : undefined;

      let changed = false;
      if (!sameTarget(nextTarget, dropTarget)) {
        dropTarget = nextTarget;
        changed = true;
      }
      if (!sameRefusal(nextRefusal, refusal)) {
        refusal = nextRefusal;
        changed = true;
      }
      if (changed) notify(listeners);
      if (refusal) notify(pointerListeners);
    },

    drop(at, files) {
      const carried = carrying;
      const outcome = at === undefined ? ELSEWHERE : resolve(at);
      // The Canvas attached now, held for the whole drop: a refusal found a
      // frame later still goes to the Canvas the drag ended over.
      const over = canvas;
      end();
      if (!carried || !over) return;
      const report = over.onRefused;

      // Released over somewhere that said no. Nothing to apply, and something
      // to say — unlike a release over `elsewhere`, which is how a drag is
      // abandoned and is meant to be silent.
      if (outcome.status === "refused") {
        report(outcome.refusal);
        return;
      }
      const target = outcome.status === "landing" ? outcome.target : undefined;

      if (carried.source === "file") {
        // A file released beside the email still carries an image the Author
        // meant to add, so it lands with no target rather than being swallowed
        // by an event that was already claimed. At once rather than settled:
        // no drag backend is holding the DOM, so there is nothing to wait for.
        if (files === undefined || files.length === 0) return;
        land(over.editor, { kind: "files", files }, target, report);
        return;
      }

      if (!target) return;
      const dropped: Dropped =
        carried.source === "canvas"
          ? {
              kind: "move",
              blockId: carried.blockId,
              blockType: carried.blockType,
            }
          : { kind: "insert", blockType: carried.blockType };
      over.settle(() => {
        land(over.editor, dropped, target, report);
      });
    },

    cancel: end,

    getCarrying: () => carrying,
    getDropTarget: () => dropTarget,
    getRefusal: () => refusal,
    getPointer: () => pointer,

    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeToPointer: (listener) => {
      pointerListeners.add(listener);
      return () => {
        pointerListeners.delete(listener);
      };
    },

    attach(next) {
      canvas = next;
      return () => {
        if (canvas !== next) return;
        end();
        canvas = undefined;
      };
    },
  };
}

/** Apply a drop, and pass on the refusal when one can be explained. */
function land(
  editor: Editor,
  dropped: Dropped,
  target: DropTarget | undefined,
  report: (refusal: DropRefusal) => void,
): void {
  // A drop is a pointer let go, wherever the drag began.
  const applied = actVia(editor, "pointer", () =>
    applyDrop(editor, dropped, target),
  );
  if (applied.status === "refused" && applied.refusal) {
    report(applied.refusal);
  }
}

function notify(listeners: ReadonlySet<() => void>): void {
  for (const listener of listeners) listener();
}

/** Whether two Drop Targets name the same place. */
function sameTarget(
  a: DropTarget | undefined,
  b: DropTarget | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.parentId === b.parentId &&
    a.index === b.index &&
    a.position === b.position &&
    a.referenceBlockId === b.referenceBlockId &&
    a.axis === b.axis
  );
}

/** Whether two refusals say the same thing about the same container. */
function sameRefusal(
  a: DropRefusal | undefined,
  b: DropRefusal | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.code === b.code && a.blockId === b.blockId && a.message === b.message
  );
}

/** Measurements in the shape Drop Target resolution reads them in. */
export function blockRectsOf(rects: ReadonlyMap<string, Rect>): BlockRect[] {
  return [...rects].map(([blockId, rect]) => ({ blockId, ...rect }));
}

const DragSessionContext = createContext<DragSession | undefined>(undefined);

export const DragSessionContextProvider = DragSessionContext.Provider;

/** The session the surrounding {@link EditorProvider} made. */
export function useDragSession(): DragSession | undefined {
  return useContext(DragSessionContext);
}

/** The same, for the Canvas, which only works inside an EditorProvider. */
export function useCanvasDragSession(): DragSession {
  const session = useContext(DragSessionContext);
  if (!session) {
    throw new Error(
      "No drag session found. Wrap the Canvas in <EditorProvider editor={…}>.",
    );
  }
  return session;
}

/** Whether the drag in flight is meeting a refusal. A selector. */
export function isRefusing(session: DragSession | undefined): boolean {
  return session?.getRefusal() !== undefined;
}

const NO_LISTENERS = (): (() => void) => (): void => undefined;

/**
 * Read one thing from the drag in flight, and re-render when that thing
 * changes. Outside an {@link EditorProvider} there is no drag, and the
 * selector is asked of nothing.
 *
 * Select the narrowest thing you need, and never build the value returned —
 * the same rules as `useEditorState`.
 */
export function useDragSessionState<TValue>(
  select: (session: DragSession | undefined) => TValue,
): TValue {
  const session = useDragSession();
  const subscribe = useCallback(
    (onChange: () => void) => session?.subscribe(onChange) ?? NO_LISTENERS(),
    [session],
  );
  const read = (): TValue => select(session);
  return useSyncExternalStore(subscribe, read, read);
}
