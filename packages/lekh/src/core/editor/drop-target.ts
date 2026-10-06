import type { Block, EmailDocument } from "../document/document";
import { canPlace, hasCapacity, type Registry } from "../document/registry";
import {
  ancestorsOf,
  childrenOf,
  containsBlock,
  findBlock,
} from "../document/tree";
import { unreachable } from "./unreachable";

/** A Block's measured position, in whatever coordinate space the caller uses. */
export interface BlockRect {
  readonly blockId: string;
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Which way a container lays its children out.
 *
 * Inferred from where the children's measured rectangles sit rather than
 * declared by a Block Definition, because the Definition already said it once
 * in the markup it emits — and saying it twice is one place for the two
 * answers to disagree.
 */
export type LayoutAxis = "vertical" | "horizontal";

/**
 * What a drag is carrying, asked before the pointer has gone anywhere.
 *
 * The rectangles are optional: without them every place is still known, and
 * only which way each parent lays its children out is not.
 */
export interface DropTargetsQuery {
  readonly draggedType: string;
  /** Set when moving an existing Block rather than inserting a new one. */
  readonly draggedBlockId?: string;
  readonly rects?: readonly BlockRect[];
}

/** What a drag currently looks like. Measured by the Consumer, never by us. */
export interface DropTargetQuery extends DropTargetsQuery {
  readonly pointer: Point;
  readonly rects: readonly BlockRect[];
}

/** Where the drop would land, once nesting rules have been applied. */
export interface DropTarget {
  readonly parentId: string;
  /**
   * Insertion index within the parent's children, counted as the Document
   * reads right now.
   *
   * One meaning whether or not a Block is being moved. A target that meant two
   * different things depending on the drag behind it could not be re-read
   * later, and re-reading it later is exactly what an Asset arriving after the
   * gesture requires (ADR-0010). `moveBlock` does its own arithmetic.
   */
  readonly index: number;
  readonly position: "before" | "after" | "inside";
  /** The Block the indicator relates to. Absent for `inside`. */
  readonly referenceBlockId?: string;
  /**
   * Which way the parent lays its children out.
   *
   * `before` and `after` mean above and below on a vertical axis and left and
   * right on a horizontal one, so an indicator drawn for a horizontal parent
   * is a vertical line down the edge of the reference. Absent on a Drop Target
   * built by hand rather than resolved, which reads as vertical.
   */
  readonly axis?: LayoutAxis;
}

/**
 * Why a container would not take the Block a drag is carrying.
 *
 * The three ways {@link resolveDropTarget} turns a candidate down, named so a
 * Consumer can say each of them in their own words.
 */
export type DropRefusalCode = "not-accepted" | "at-capacity" | "own-subtree";

/**
 * A container's refusal, reported in the shape a Diagnostic reports a finding.
 *
 * A stable `code` to branch on, a `message` to fall back to, and the Block the
 * finding concerns — the same three the render path already surfaces its own
 * findings with, because this is the same kind of thing: something the Author
 * asked for that cannot happen, said in terms they can act on.
 */
export interface DropRefusal {
  readonly code: DropRefusalCode;
  /** Human-readable fallback, composed from the two Definitions' labels. */
  readonly message: string;
  /** The container that refused. */
  readonly blockId: string;
}

/**
 * What a drag hovering somewhere comes to.
 *
 * Three states rather than a Drop Target and nothing, because "nothing" was
 * two different answers wearing one face: a container turned the Block down,
 * and the pointer is not over the email at all. Only the first is worth
 * telling an Author about — the second is how they cancel, by carrying the
 * Block back off the Canvas and letting go.
 */
export type DropOutcome =
  | { readonly status: "landing"; readonly target: DropTarget }
  | { readonly status: "refused"; readonly refusal: DropRefusal }
  | { readonly status: "elsewhere" };

const ELSEWHERE: DropOutcome = { status: "elsewhere" };

/**
 * Resolve a drag to an insertion point.
 *
 * A pure function of pointer position, Block rectangles and accepts rules: it
 * measures nothing and touches no DOM, which is what keeps the browser seam
 * thin and drag behaviour testable without a layout engine.
 *
 * Resolution starts at the Block under the pointer and walks up until it finds
 * an ancestor that accepts the dragged type, so dropping onto a leaf still
 * lands somewhere sensible.
 *
 * Once a parent is chosen the drop lands beside one of its children — the one
 * under the pointer, or failing that the one nearest it. A container's padding
 * and the gaps between its children are the space an Author aims at when they
 * mean "between these two", so they resolve to a position between them.
 * `inside` is left for a container with nothing measurable in it.
 *
 * When every candidate turns the drag down the walk reports why rather than
 * going quiet, so the Canvas has something to say to an Author whose drop
 * would otherwise do nothing at all.
 */
export function resolveDropTarget(
  document: EmailDocument,
  registry: Registry,
  query: DropTargetQuery,
): DropOutcome {
  const root = document.root;
  const rectsById = new Map(query.rects.map((rect) => [rect.blockId, rect]));
  const hovered = findHoveredBlock(root, query.pointer, rectsById);
  if (!hovered) return ELSEWHERE;

  const chain = [hovered, ...ancestorsOf(root, hovered.id)];
  const refusals: { block: Block; code: DropRefusalCode }[] = [];

  for (const candidate of chain) {
    const refused = refusalCodeOf(
      root,
      candidate,
      registry,
      query.draggedType,
      query.draggedBlockId,
    );
    if (refused !== undefined) {
      refusals.push({ block: candidate, code: refused });
      continue;
    }

    const children = childrenOf(candidate);
    const childRects = children.map((child) => rectsById.get(child.id));
    const axis = layoutAxisOf(childRects);

    // The child the pointer is inside, if it is inside one. A Block with no
    // rectangle of its own cannot be sat beside, so it does not count.
    const containing = children.findIndex(
      (child) =>
        child.id === hovered.id || findBlock(child, hovered.id) !== undefined,
    );
    const referenceIndex =
      containing !== -1 && childRects[containing] !== undefined
        ? containing
        : nearestIndex(childRects, query.pointer, axis);

    const reference = children[referenceIndex];
    const referenceRect = childRects[referenceIndex];

    // Nothing to sit beside: an empty container, or one whose children all
    // rendered something unmeasurable.
    if (reference === undefined || referenceRect === undefined) {
      return {
        status: "landing",
        target: {
          parentId: candidate.id,
          index: children.length,
          position: "inside",
          axis,
        },
      };
    }

    const after = along(query.pointer, axis) >= midpointOf(referenceRect, axis);
    return {
      status: "landing",
      target: {
        parentId: candidate.id,
        index: after ? referenceIndex + 1 : referenceIndex,
        position: after ? "after" : "before",
        referenceBlockId: reference.id,
        axis,
      },
    };
  }

  return refusalOutcome(refusals, registry, query.draggedType);
}

/**
 * Every place a drag may land, known the moment it starts.
 *
 * The same three refusals {@link resolveDropTarget} applies, asked of every
 * Block rather than of the chain under a pointer, so a place listed here is
 * never one a drop there would be turned away from. The pointer only chooses
 * among them.
 *
 * Each gap is listed once: before each child, and after the last. Resolving
 * names a gap from whichever neighbour the pointer is nearer, so compare the
 * two by `parentId` and `index`. A container with nothing measurable in it is
 * one place, `inside` it.
 *
 * In Document order, a parent's places before its children's.
 */
export function getDropTargets(
  document: EmailDocument,
  registry: Registry,
  query: DropTargetsQuery,
): DropTarget[] {
  const root = document.root;
  const rectsById =
    query.rects && new Map(query.rects.map((rect) => [rect.blockId, rect]));
  const targets: DropTarget[] = [];

  const visit = (block: Block): void => {
    const refused = refusalCodeOf(
      root,
      block,
      registry,
      query.draggedType,
      query.draggedBlockId,
    );
    if (refused === undefined) {
      targets.push(...targetsIn(block, rectsById));
    }
    for (const child of childrenOf(block)) visit(child);
  };

  visit(root);
  return targets;
}

/** The places inside one container that takes the drag. */
function targetsIn(
  parent: Block,
  rectsById: ReadonlyMap<string, BlockRect> | undefined,
): DropTarget[] {
  const children = childrenOf(parent);
  const childRects = children.map((child) => rectsById?.get(child.id));
  const axis = rectsById ? { axis: layoutAxisOf(childRects) } : {};

  // Resolving sits a drop beside a measured child only. Without rectangles
  // every child counts, because nothing has been measured to say otherwise.
  const beside = children
    .map((child, index) => ({ child, index }))
    .filter(({ index }) => !rectsById || childRects[index] !== undefined);

  const last = beside.at(-1);
  if (!last) {
    return [
      {
        parentId: parent.id,
        index: children.length,
        position: "inside",
        ...axis,
      },
    ];
  }

  return [
    ...beside.map(({ child, index }): DropTarget => ({
      parentId: parent.id,
      index,
      position: "before",
      referenceBlockId: child.id,
      ...axis,
    })),
    {
      parentId: parent.id,
      index: last.index + 1,
      position: "after",
      referenceBlockId: last.child.id,
      ...axis,
    },
  ];
}

/**
 * Why a named parent would not take a Block of this type, if it would not.
 *
 * The same three rules {@link resolveDropTarget} walks the chain applying,
 * asked of one parent without a pointer. It answers the moment after a drop:
 * the gesture resolved to a Drop Target, the Document moved underneath it, and
 * the insertion was refused anyway — where the Author is owed the same
 * sentence they would have got had the drag never resolved at all.
 */
export function explainDropRefusal(
  document: EmailDocument,
  registry: Registry,
  parentId: string,
  draggedType: string,
  draggedBlockId?: string,
): DropRefusal | undefined {
  const root = document.root;
  const parent = findBlock(root, parentId);
  if (!parent) return undefined;

  const code = refusalCodeOf(
    root,
    parent,
    registry,
    draggedType,
    draggedBlockId,
  );
  if (code === undefined) return undefined;

  return {
    code,
    message: refusalMessage(code, parent, registry, draggedType),
    blockId: parent.id,
  };
}

/**
 * Why a candidate turned the drag down, or `undefined` if it did not.
 *
 * The three branches are asked in the order an Author would find them
 * surprising: being inside the thing you are carrying beats every other
 * reason, and a container that does not take this type at all is a different
 * fact from one that would but is full.
 */
function refusalCodeOf(
  root: Block,
  candidate: Block,
  registry: Registry,
  draggedType: string,
  draggedBlockId: string | undefined,
): DropRefusalCode | undefined {
  // Nothing may be dropped into itself or into its own subtree.
  if (
    draggedBlockId !== undefined &&
    (candidate.id === draggedBlockId ||
      containsBlock(root, draggedBlockId, candidate.id))
  ) {
    return "own-subtree";
  }

  const definition = registry.get(candidate.type);
  if (!canPlace(registry, definition, draggedType)) return "not-accepted";
  if (!hasCapacity(candidate, definition, draggedBlockId)) return "at-capacity";
  return undefined;
}

/**
 * Which of the refusals to actually report.
 *
 * The nearest candidate that is a container at all — one whose Definition
 * declares `accepts` — rather than the Block under the pointer, which is
 * usually a leaf. "A Column is not allowed inside a Text" is true and useless:
 * a Text is not a place, and the Author was aiming at the Section around it.
 *
 * Falls back to the deepest refusal when nothing in the chain is a container,
 * which is honest rather than helpful, and is as good as it gets in an email
 * that has nowhere to put anything.
 */
function refusalOutcome(
  refusals: readonly { block: Block; code: DropRefusalCode }[],
  registry: Registry,
  draggedType: string,
): DropOutcome {
  const reported =
    refusals.find(
      ({ block }) => registry.get(block.type)?.accepts !== undefined,
    ) ?? refusals[0];
  // Only reachable with an empty chain, which the hovered Block rules out.
  if (!reported) return ELSEWHERE;

  return {
    status: "refused",
    refusal: {
      code: reported.code,
      message: refusalMessage(
        reported.code,
        reported.block,
        registry,
        draggedType,
      ),
      blockId: reported.block.id,
    },
  };
}

/**
 * The refusal in words, for a Consumer who has not written their own.
 *
 * Deliberately does not hedge with "directly". By the time this is composed
 * every candidate from the pointer to the root has refused, so there is no
 * shallower or deeper spot in that chain to try — and a message hinting at one
 * would send the Author looking for a way through that is not there.
 */
function refusalMessage(
  code: DropRefusalCode,
  container: Block,
  registry: Registry,
  draggedType: string,
): string {
  const dragged = labelOf(registry, draggedType);
  const parent = labelOf(registry, container.type);

  switch (code) {
    case "not-accepted":
      return `${dragged} is not allowed inside ${parent}.`;
    case "at-capacity":
      return `${parent} is full.`;
    case "own-subtree":
      return `A ${dragged} cannot be moved inside itself.`;
    default:
      return unreachable(code);
  }
}

/** A type in the words an Author reads it in, falling back to the type id. */
function labelOf(registry: Registry, type: string): string {
  return registry.get(type)?.label ?? type;
}

/**
 * Which way a parent lays its children out, read off their rectangles.
 *
 * Siblings sharing a line overlap down the y axis and not across the x one;
 * stacked siblings do the opposite. Adjacent pairs vote, so one child that
 * floats out of the flow does not decide the whole container, and a parent
 * with fewer than two measured children stacks by default — there is nothing
 * to be side by side with.
 */
function layoutAxisOf(
  childRects: readonly (BlockRect | undefined)[],
): LayoutAxis {
  let horizontal = 0;
  let vertical = 0;
  let previous: BlockRect | undefined;

  for (const current of childRects) {
    if (current === undefined) continue;
    if (previous !== undefined) {
      const down = overlap(
        previous.top,
        previous.height,
        current.top,
        current.height,
      );
      const across = overlap(
        previous.left,
        previous.width,
        current.left,
        current.width,
      );
      if (down > across) horizontal++;
      else vertical++;
    }
    previous = current;
  }

  return horizontal > vertical ? "horizontal" : "vertical";
}

/** How much of one span another shares, negative when they are apart. */
function overlap(
  startA: number,
  sizeA: number,
  startB: number,
  sizeB: number,
): number {
  return Math.min(startA + sizeA, startB + sizeB) - Math.max(startA, startB);
}

/**
 * The measured child nearest the pointer along the layout axis.
 *
 * Distance is to the child's near edge, so every child the pointer sits inside
 * is equally near — and a tie between two neighbours is harmless, because
 * "after the earlier one" and "before the later one" are the same index.
 *
 * -1 when no child was measured.
 */
function nearestIndex(
  childRects: readonly (BlockRect | undefined)[],
  pointer: Point,
  axis: LayoutAxis,
): number {
  const at = along(pointer, axis);

  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  childRects.forEach((rect, index) => {
    if (rect === undefined) return;
    const start = startOf(rect, axis);
    const end = start + extentOf(rect, axis);
    const distance = at < start ? start - at : Math.max(at - end, 0);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });

  return best;
}

/** The pointer's position along one axis. */
function along(pointer: Point, axis: LayoutAxis): number {
  return axis === "horizontal" ? pointer.x : pointer.y;
}

/** Where a rectangle begins along one axis. */
function startOf(rect: BlockRect, axis: LayoutAxis): number {
  return axis === "horizontal" ? rect.left : rect.top;
}

/** How far a rectangle runs along one axis. */
function extentOf(rect: BlockRect, axis: LayoutAxis): number {
  return axis === "horizontal" ? rect.width : rect.height;
}

/** The rectangle's halfway point along one axis: the before/after line. */
function midpointOf(rect: BlockRect, axis: LayoutAxis): number {
  return startOf(rect, axis) + extentOf(rect, axis) / 2;
}

/** The deepest Block whose rectangle contains the pointer. */
function findHoveredBlock(
  root: Block,
  pointer: Point,
  rectsById: ReadonlyMap<string, BlockRect>,
): Block | undefined {
  let best: Block | undefined;
  let bestDepth = -1;
  let bestArea = Number.POSITIVE_INFINITY;

  const search = (block: Block, depth: number): void => {
    const rect = rectsById.get(block.id);
    if (rect && contains(rect, pointer)) {
      const area = rect.width * rect.height;
      if (depth > bestDepth || (depth === bestDepth && area < bestArea)) {
        best = block;
        bestDepth = depth;
        bestArea = area;
      }
    }
    for (const child of childrenOf(block)) search(child, depth + 1);
  };

  search(root, 0);
  return best;
}

function contains(rect: BlockRect, pointer: Point): boolean {
  return (
    pointer.x >= rect.left &&
    pointer.x < rect.left + rect.width &&
    pointer.y >= rect.top &&
    pointer.y < rect.top + rect.height
  );
}
