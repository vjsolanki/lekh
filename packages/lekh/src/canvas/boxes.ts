"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

import type { BlockDefinition, BoxSide } from "../core/document/definition";
import type { EmailDocument } from "../core/document/document";
import { resolveProps, rootPropsOf } from "../core/document/props";
import { findBlock } from "../core/document/tree";
import type { Editor } from "../core/editor/editor";
import { isOverridable, type Stage } from "../core/layout/responsive";
import {
  paddingBoxOf,
  rectOf,
  sameRect,
  toCanvasSpace,
  type Rect,
} from "./geometry";
import { BLOCK_ID_ATTRIBUTE } from "./tree";

/**
 * One side of a Box, where the Canvas drew it (ADR-0040).
 *
 * `rect` is the band the side's padding fills, inside any border, at the size
 * the email is drawn (ADR-0039). Its thickness is the side's value at the
 * zoom. `prop` is what a grip on this edge writes; a prop holding two sides,
 * such as a button's top and bottom, names two edges.
 */
export interface BoxEdge {
  readonly box: string;
  readonly side: BoxSide;
  readonly prop: string;
  readonly rect: Rect;
}

/** A Box as declared, with each side's value on the Stage in view. */
interface DeclaredBox {
  readonly box: string;
  readonly sides: readonly {
    readonly side: BoxSide;
    readonly prop: string;
    readonly value: number;
  }[];
}

/**
 * A Definition's Boxes, in Schema order, read off resolved props. On the
 * mobile Stage only the sides that can carry a Mobile Override, as the
 * Inspector describes there: a grip on any other would do nothing.
 */
function boxesOf(
  definition: BlockDefinition,
  props: Readonly<Record<string, unknown>>,
  stage: Stage,
): readonly DeclaredBox[] {
  const boxes = new Map<string, DeclaredBox["sides"][number][]>();
  for (const [prop, entry] of Object.entries(definition.schema)) {
    if (entry.box === undefined || entry.side === undefined) continue;
    if (stage === "mobile" && !isOverridable(entry)) continue;
    const value = props[prop];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const sides = boxes.get(entry.box) ?? [];
    for (const side of typeof entry.side === "string"
      ? [entry.side]
      : entry.side) {
      sides.push({ side, prop, value });
    }
    boxes.set(entry.box, sides);
  }
  return [...boxes].map(([box, sides]) => ({ box, sides }));
}

const PADDING = {
  top: "paddingTop",
  right: "paddingRight",
  bottom: "paddingBottom",
  left: "paddingLeft",
} as const;

/** A computed length, which a browser always reports in pixels. */
function px(length: string): number {
  return Number(length.replace(/px$/u, ""));
}

/**
 * Where each Box of one Block is drawn, in the frame's own space.
 *
 * lekh does not know a Definition's markup, so it reads what was drawn: a Box
 * is the first element of the Block — not of a Block inside it — whose
 * computed padding matches every side's value. Boxes claim elements in Schema
 * order, so two Boxes with the same values still land on two elements, and
 * the first declared takes the outer one. A Block declares its outer Box
 * first. A Box drawn some other way, such as with spacer cells, matches nothing and has no
 * edges.
 */
function edgesIn(
  element: Element,
  boxes: readonly DeclaredBox[],
): readonly BoxEdge[] {
  const view = element.ownerDocument.defaultView;
  if (!view) return [];
  const own = [element, ...element.querySelectorAll("*")].filter(
    (candidate) => candidate.closest(`[${BLOCK_ID_ATTRIBUTE}]`) === element,
  );

  const claimed = new Set<Element>();
  const edges: BoxEdge[] = [];
  for (const { box, sides } of boxes) {
    const holder = own.find((candidate) => {
      if (claimed.has(candidate)) return false;
      const style = view.getComputedStyle(candidate);
      return sides.every(
        ({ side, value }) => Math.abs(px(style[PADDING[side]]) - value) < 0.5,
      );
    });
    if (!holder) continue;
    claimed.add(holder);

    const style = view.getComputedStyle(holder);
    const outer = rectOf(holder.getBoundingClientRect());
    const top = outer.top + px(style.borderTopWidth);
    const left = outer.left + px(style.borderLeftWidth);
    const width =
      outer.width - px(style.borderLeftWidth) - px(style.borderRightWidth);
    const height =
      outer.height - px(style.borderTopWidth) - px(style.borderBottomWidth);

    for (const { side, prop, value } of sides) {
      const rect: Rect =
        side === "top"
          ? { top, left, width, height: value }
          : side === "bottom"
            ? { top: top + height - value, left, width, height: value }
            : side === "left"
              ? { top, left, width: value, height }
              : { top, left: left + width - value, width: value, height };
      edges.push({ box, side, prop, rect });
    }
  }
  return edges;
}

/** What {@link useBoxEdges} reads. */
export interface BoxEdgesSetup {
  readonly editor: Editor;
  readonly canvasElement: RefObject<HTMLDivElement | null>;
  readonly frameElement: RefObject<HTMLIFrameElement | null>;
  readonly frameDocument: Document | null;
  /** What is drawn, Pending Change and all, so a grip follows its drag. */
  readonly emailDocument: EmailDocument;
  readonly selection: string | undefined;
  readonly stage: Stage;
  readonly zoom: number;
  /**
   * Every Block's rectangle, as last measured. Read only as a sign the email
   * moved, so the edges are measured again in the same commit.
   */
  readonly rects: ReadonlyMap<string, Rect>;
}

const NO_EDGES: readonly BoxEdge[] = [];

/**
 * The edges of the selected Block's Boxes, in the Canvas's space.
 *
 * Measured after the Blocks are, whenever the email, the selection, the Stage
 * or the zoom moves. A pass that finds the same edges sets no state.
 */
export function useBoxEdges({
  editor,
  canvasElement,
  frameElement,
  frameDocument,
  emailDocument,
  selection,
  stage,
  zoom,
  rects,
}: BoxEdgesSetup): readonly BoxEdge[] {
  const [edges, setEdges] = useState(NO_EDGES);

  useLayoutEffect(() => {
    const next = ((): readonly BoxEdge[] => {
      const canvas = canvasElement.current;
      const frame = frameElement.current;
      if (!canvas || !frame || !frameDocument || selection === undefined) {
        return NO_EDGES;
      }
      const block = findBlock(emailDocument.root, selection);
      const definition = block && editor.getDefinition(block.type);
      const element = frameDocument.querySelector(
        `[${BLOCK_ID_ATTRIBUTE}="${CSS.escape(selection)}"]`,
      );
      if (!block || !definition || !element) return NO_EDGES;

      const props = resolveProps(block, definition, {
        stage,
        rootProps: rootPropsOf(emailDocument.root, (type) =>
          editor.getDefinition(type),
        ),
      });
      const boxes = boxesOf(definition, props, stage);
      if (boxes.length === 0) return NO_EDGES;

      const canvasRect = paddingBoxOf(canvas);
      const frameRect = rectOf(frame.getBoundingClientRect());
      return edgesIn(element, boxes).map((edge) => ({
        ...edge,
        rect: toCanvasSpace(edge.rect, frameRect, canvasRect, zoom),
      }));
    })();
    setEdges((current) => (sameEdges(current, next) ? current : next));
  }, [
    editor,
    canvasElement,
    frameElement,
    frameDocument,
    emailDocument,
    selection,
    stage,
    zoom,
    rects,
  ]);

  return edges;
}

function sameEdges(a: readonly BoxEdge[], b: readonly BoxEdge[]): boolean {
  return (
    a.length === b.length &&
    a.every((edge, index) => {
      const other = b[index];
      return (
        other !== undefined &&
        edge.box === other.box &&
        edge.side === other.side &&
        edge.prop === other.prop &&
        sameRect(edge.rect, other.rect)
      );
    })
  );
}
