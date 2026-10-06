"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import type { EmailDocument } from "../core/document/document";
import {
  paddingBoxOf,
  rectOf,
  sameRect,
  sameRects,
  toCanvasSpace,
  type Rect,
} from "./geometry";
import type { TextSelection } from "./text";
import { blockElementsIn, standInBlockIdsIn } from "./tree";

const NO_RECTS: ReadonlyMap<string, Rect> = new Map();
const NO_STAND_INS: ReadonlySet<string> = new Set();

/** What the Canvas measures, and when. */
export interface MeasurementSetup {
  readonly canvasElement: RefObject<HTMLDivElement | null>;
  readonly frameElement: RefObject<HTMLIFrameElement | null>;
  readonly frameDocument: Document | null;
  /** What is on screen, which re-measures whenever it changes. */
  readonly emailDocument: EmailDocument;
  readonly frameWidth: number | string;
  /** How much larger the email is drawn than laid out (ADR-0039). */
  readonly zoom: number;
  /**
   * The Author's text selection as last reported, measured in the same pass.
   * A ref, so a pass between renders reads the latest one.
   */
  readonly reportedSelection: RefObject<TextSelection | undefined>;
  /** The same selection as rendered, which re-measures when it changes. */
  readonly textSelection: TextSelection | undefined;
}

/** Every rendered Block, where it is and what the Canvas had to give a box. */
export interface Measurements {
  readonly rects: ReadonlyMap<string, Rect>;
  /** The Blocks the Canvas gave a box to, because they had nothing to show. */
  readonly standIns: ReadonlySet<string>;
  readonly textRect: Rect | undefined;
  /**
   * The latest measurement, without waiting for a render. What drag handlers
   * read, because they run between renders.
   */
  readonly measured: RefObject<ReadonlyMap<string, Rect>>;
  /** Measure now, and answer with what was found. */
  readonly measure: () => ReadonlyMap<string, Rect>;
}

/**
 * Measure every rendered Block, in the Canvas's own coordinate space.
 *
 * One pass feeds both jobs: positioning the Consumer's Chrome, and standing
 * in for the DOM in Drop Target resolution, which is a pure function that
 * measures nothing itself.
 *
 * A pass that finds nothing moved sets no state, so it renders nothing: the
 * rectangles and the stand-in ids are compared before they are stored.
 */
export function useBlockMeasurements({
  canvasElement,
  frameElement,
  frameDocument,
  emailDocument,
  frameWidth,
  zoom,
  reportedSelection,
  textSelection,
}: MeasurementSetup): Measurements {
  const [rects, setRects] = useState(NO_RECTS);
  // Mirrored so drag handlers read the latest measurement without waiting for
  // a render, and so a measurement pass can tell whether anything moved.
  const measured = useRef(NO_RECTS);

  // Which Blocks the Canvas had to give a box to, found in the same pass that
  // measures them, because both are facts about what was actually drawn.
  const [standIns, setStandIns] = useState(NO_STAND_INS);
  const foundStandIns = useRef(NO_STAND_INS);

  const [textRect, setTextRect] = useState<Rect | undefined>(undefined);
  const measuredTextRect = useRef<Rect | undefined>(undefined);

  // Whether a pass is already waiting on the frame's animations to finish.
  const waitingOnAnimations = useRef(false);

  const measure = useCallback((): ReadonlyMap<string, Rect> => {
    const canvas = canvasElement.current;
    const frame = frameElement.current;
    if (!canvas || !frame || !frameDocument) return measured.current;

    // A Block moved by an animation is measured where it is drawn this frame,
    // not where it will rest. A Consumer sliding Blocks into place after a
    // drop would leave every rectangle where the slide started, and nothing
    // else re-measures: an animated transform changes no size and no
    // Document. So a pass that finds one running measures again once it ends.
    const running = finiteAnimationsIn(frameDocument);
    if (running.length > 0 && !waitingOnAnimations.current) {
      waitingOnAnimations.current = true;
      void Promise.allSettled(
        running.map((animation) => animation.finished),
      ).then(() => {
        waitingOnAnimations.current = false;
        return measureAgain.current();
      });
    }

    const canvasRect = paddingBoxOf(canvas);
    const frameRect = rectOf(frame.getBoundingClientRect());

    const next = new Map<string, Rect>();
    for (const [blockId, element] of blockElementsIn(frameDocument)) {
      next.set(
        blockId,
        toCanvasSpace(
          rectOf(element.getBoundingClientRect()),
          frameRect,
          canvasRect,
          zoom,
        ),
      );
    }

    // The selected range is measured in the same pass and translated the same
    // way, so a toolbar drawn against it follows the text it is formatting.
    const range = reportedSelection.current?.measure();
    const rangeRect = range
      ? toCanvasSpace(range, frameRect, canvasRect, zoom)
      : undefined;
    if (!sameRect(rangeRect, measuredTextRect.current)) {
      measuredTextRect.current = rangeRect;
      setTextRect(rangeRect);
    }

    const nextStandIns = standInBlockIdsIn(frameDocument);
    if (!sameIds(nextStandIns, foundStandIns.current)) {
      foundStandIns.current = nextStandIns;
      setStandIns(nextStandIns);
    }

    if (sameRects(next, measured.current)) return measured.current;
    measured.current = next;
    setRects(next);
    return next;
  }, [canvasElement, frameElement, frameDocument, reportedSelection, zoom]);

  // The latest pass, for one that waited on an animation to call.
  const measureAgain = useRef(measure);
  useLayoutEffect(() => {
    measureAgain.current = measure;
  }, [measure]);

  // Re-measure whenever what is on screen could have changed shape.
  useLayoutEffect(() => {
    measure();
  }, [measure, emailDocument, frameWidth, textSelection]);

  useEffect(() => {
    if (!frameDocument) return undefined;
    const frameWindow = frameDocument.defaultView;
    const canvas = canvasElement.current;
    const remeasure = (): void => {
      measure();
    };

    // Resizing only. There are deliberately no `scroll` listeners here: the
    // frame is sized to its content and does not scroll, and under the
    // Consumer's scroller the Canvas and the frame move together — so
    // `toCanvasSpace` subtracts two rectangles that shifted by the same amount
    // and returns the same numbers it returned before. Nothing to recompute.
    frameWindow?.addEventListener("resize", remeasure);
    globalThis.addEventListener("resize", remeasure);

    const canvasObserver = new ResizeObserver(remeasure);
    if (canvas) canvasObserver.observe(canvas);

    return () => {
      frameWindow?.removeEventListener("resize", remeasure);
      globalThis.removeEventListener("resize", remeasure);
      canvasObserver.disconnect();
    };
  }, [canvasElement, frameDocument, measure]);

  /**
   * Re-measure a Block that settles into its size after it was measured.
   *
   * The pass above runs in a layout effect, which is the earliest the rendered
   * tree can be read — and still too early for everything. A Text Engine mounts
   * its surface in an ordinary effect, so a text Block is an empty element with
   * no line box at all when the layout effect reaches it and a line tall a
   * moment later (ADR-0005); an image settles at its intrinsic size when it
   * loads; a font arrives whenever it arrives. None of them changes the
   * Document, so no other pass would notice, and the Block would keep the
   * height it never had — along with every Block underneath it.
   *
   * Observed Block by Block, because the frame's body cannot see any of it: a
   * root Block that emits a whole email document renders to the frame's own
   * `<html>`, and body is then the height of the viewport whatever the email
   * inside it does.
   */
  useEffect(() => {
    const frameWindow = frameDocument?.defaultView;
    if (!frameDocument || !frameWindow) return undefined;

    const observer = new frameWindow.ResizeObserver(() => {
      measure();
    });
    for (const [blockId, element] of blockElementsIn(frameDocument)) {
      // Every observation reports once when it starts, which is what catches a
      // surface that mounted during this same commit: a child's effects have
      // all run by the time a parent's do, so the size the first report carries
      // is the settled one.
      if (blockId !== emailDocument.root.id) observer.observe(element);
    }

    return () => {
      observer.disconnect();
    };
  }, [frameDocument, measure, emailDocument]);

  return { rects, standIns, textRect, measured, measure };
}

/**
 * The animations running in the frame that will end. One that repeats forever,
 * a spinner in the email say, would keep a pass waiting for good.
 */
function finiteAnimationsIn(frameDocument: Document): readonly Animation[] {
  if (typeof frameDocument.getAnimations !== "function") return [];
  return frameDocument
    .getAnimations()
    .filter(
      (animation) =>
        animation.playState === "running" &&
        Number.isFinite(animation.effect?.getComputedTiming().endTime),
    );
}

/** Whether two passes over the frame found the same Blocks. */
function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}
