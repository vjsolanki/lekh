import type { Block, EmailDocument } from "../core/document/document";
import {
  ancestorsOf,
  childrenOf,
  findBlock,
  findLocation,
  insertChild,
} from "../core/document/tree";
import { applyOp } from "../core/editor/op";
import type { PendingChange } from "../core/editor/pending-change";
import type { Suggestion } from "../core/editor/suggestion";
import type { Rect } from "./geometry";
import type { TouchedBlock } from "./slots";

/** What the Canvas draws from, read from the editor. */
export interface DrawnInput {
  /** The stored Document. */
  readonly stored: EmailDocument;
  /** The stored Document with every open Suggestion applied. */
  readonly withSuggestions: EmailDocument;
  readonly suggestions: readonly Suggestion[];
  readonly pending: PendingChange | undefined;
}

/**
 * The Document as the Canvas draws it: the stored one, plus every open
 * Suggestion, plus the Pending Change (ADR-0032, ADR-0035).
 *
 * Unlike `getDocumentWithSuggestions`, a Block a Suggestion removes is
 * still drawn, where it is stored, until the Suggestion is accepted. The Author sees what is going as well as what is coming, and the
 * `suggestion` Slot has a rectangle to mark it with.
 *
 * The Pending Change goes on top: it is the drag the Author's hand is on now.
 */
export function drawnDocument({
  stored,
  withSuggestions,
  suggestions,
  pending,
}: DrawnInput): EmailDocument {
  const removed = suggestions.flatMap((suggestion) =>
    suggestion.status === "stale"
      ? []
      : suggestion.touches.flatMap((touch) =>
          touch.change === "remove" ? [touch.blockId] : [],
        ),
  );
  const kept = keepRemoved(withSuggestions, stored, removed);
  if (!pending || pending.ops.length === 0) return kept;
  return { ...kept, root: pending.ops.reduce<Block>(applyOp, kept.root) };
}

/**
 * Put Blocks back that a Suggestion removes, each in the parent it is stored
 * in, after the nearest earlier sibling that is still drawn.
 *
 * Outermost first, so a removed Section comes back with what is in it. Any of
 * its Blocks the Suggestion moved out are left where they went, rather than
 * drawn twice. One whose parent is not drawn is left out.
 */
export function keepRemoved(
  drawn: EmailDocument,
  stored: EmailDocument,
  removed: readonly string[],
): EmailDocument {
  if (removed.length === 0) return drawn;
  const outermostFirst = [...new Set(removed)]
    .map((blockId) => ({
      blockId,
      depth: ancestorsOf(stored.root, blockId).length,
    }))
    .toSorted((left, right) => left.depth - right.depth);

  let root = drawn.root;
  for (const { blockId } of outermostFirst) {
    if (findBlock(root, blockId)) continue;
    const location = findLocation(stored.root, blockId);
    const block = location && childrenOf(location.parent)[location.index];
    const parent = location && findBlock(root, location.parent.id);
    if (!location || !block || !parent) continue;
    const drawnSiblings = childrenOf(parent);
    const anchor = childrenOf(location.parent)
      .slice(0, location.index)
      .findLast((sibling) => drawnSiblings.some(({ id }) => id === sibling.id));
    const index =
      anchor === undefined
        ? 0
        : drawnSiblings.findIndex(({ id }) => id === anchor.id) + 1;
    const present = root;
    root = insertChild(
      root,
      parent.id,
      index,
      withoutDescendants(block, (id) => findBlock(present, id) !== undefined),
    );
  }
  return root === drawn.root ? drawn : { ...drawn, root };
}

/** A Block with every descendant `drop` names taken out. */
function withoutDescendants(
  block: Block,
  drop: (blockId: string) => boolean,
): Block {
  if (!block.children) return block;
  return {
    ...block,
    children: block.children
      .filter((child) => !drop(child.id))
      .map((child) => withoutDescendants(child, drop)),
  };
}

/**
 * Every Block a Suggestion touches that the Canvas drew, with its rectangle
 * and how it was touched. One it does not draw, an insert of a stale one say,
 * is left out.
 */
export function touchedBlocks(
  suggestion: Suggestion,
  drawn: EmailDocument,
  rects: ReadonlyMap<string, Rect>,
): readonly TouchedBlock[] {
  return suggestion.touches.flatMap(({ blockId, change, props }) => {
    const block = findBlock(drawn.root, blockId);
    const rect = rects.get(blockId);
    return block && rect ? [{ block, rect, change, props }] : [];
  });
}
