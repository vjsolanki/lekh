import { applyDrop, type Dropped } from "./drop";
import type { DropTarget } from "./drop-target";
import { actVia, type Editor } from "./editor";
import { richTextPropOf } from "../document/definition";
import type { Block } from "../document/document";
import { childrenOf, findLocation } from "../document/tree";

/**
 * The named actions a keybinding can resolve to.
 *
 * Every one of them is also a method on {@link Commands}, so a Consumer can
 * drive the same action from their own toolbar button.
 */
export type CommandName =
  | "undo"
  | "redo"
  | "delete"
  | "duplicate"
  | "moveUp"
  | "moveDown"
  | "stopEditing"
  | "stepOut"
  | "selectFirstChild"
  | "selectPrevious"
  | "selectNext";

/**
 * Every command, as a method, plus a matching check under `can`.
 *
 * Each method returns whether it did anything. Its `can` check says the same
 * thing without running it, so a Consumer can grey out a button before it is
 * pressed. The two use the same rule, so they never disagree.
 */
export type Commands = {
  readonly [TName in CommandName]: () => boolean;
} & {
  readonly can: { readonly [TName in CommandName]: () => boolean };
};

/**
 * Build the command set for an editor.
 *
 * Pure editor manipulation: nothing here touches the DOM or React, so the
 * Canvas can bind these to keystrokes and a Consumer can call them from
 * anywhere, a server included.
 */
export function createCommands(editor: Editor): Commands {
  /**
   * Where a nudge one sibling along would land the selection, as a drop. Not
   * yet checked against the parent's rules.
   */
  const nudgeTarget = (
    offset: -1 | 1,
  ):
    { dropped: Dropped & { kind: "move" }; target: DropTarget } | undefined => {
    const blockId = editor.getSelection();
    if (blockId === undefined) return undefined;

    const location = findLocation(editor.getDocument().root, blockId);
    if (!location) return undefined;

    const siblings = childrenOf(location.parent);
    const moved = siblings[location.index];
    const sibling = siblings[location.index + offset];
    if (!moved || !sibling) return undefined;
    const before = offset === -1;
    // Indices count the Document as it reads now, so swapping with the sibling
    // above means taking its position, and swapping with the one below means
    // landing past it.
    const index = location.index + offset;
    return {
      dropped: { kind: "move", blockId, blockType: moved.type },
      target: {
        parentId: location.parent.id,
        index: before ? index : index + 1,
        position: before ? "before" : "after",
        referenceBlockId: sibling.id,
      },
    };
  };

  /** Move the selection within its own parent, by whole sibling positions. */
  const nudge = (offset: -1 | 1): boolean => {
    const nudged = nudgeTarget(offset);
    // A drop one sibling along, through the same step a drag lands with.
    return (
      nudged !== undefined &&
      applyDrop(editor, nudged.dropped, nudged.target).status === "applied"
    );
  };

  // A move drop lands through `moveBlock`, so `canMove` is its check.
  const canNudge = (offset: -1 | 1): boolean => {
    const nudged = nudgeTarget(offset);
    return (
      nudged !== undefined &&
      editor.canMove(
        nudged.dropped.blockId,
        nudged.target.parentId,
        nudged.target.index,
      )
    );
  };

  /** Whether the selection, if any, passes a check on its id. */
  const selected = (check: (blockId: string) => boolean): boolean => {
    const blockId = editor.getSelection();
    return blockId !== undefined && check(blockId);
  };

  const isEditing = (): boolean => editor.getEditing() !== undefined;

  /**
   * The Blocks an Author steps between inside this one, in reading order.
   *
   * A Structural Block child is passed through to its own children, since it is
   * reached only through its owner (ADR-0031). So a grid's Blocks are the
   * Blocks in its cells, one cell after the next.
   */
  const reachableChildren = (block: Block): readonly Block[] =>
    childrenOf(block).flatMap((child) => {
      const selectable = editor.getSelectable(child.id);
      if (selectable === child.id) return [child];
      // Unregistered: not reachable, and nothing under it is either.
      if (selectable === undefined) return [];
      return reachableChildren(child);
    });

  /**
   * The Block a step out of this one lands on: the nearest one above it an
   * Author may select. `undefined` for the root, which a step never selects.
   */
  const reachableParent = (blockId: string): string | undefined => {
    const root = editor.getDocument().root;
    const location = findLocation(root, blockId);
    if (!location) return undefined;
    const parent = editor.getSelectable(location.parent.id);
    return parent === root.id ? undefined : parent;
  };

  /** The Block one sibling along from the selection, in stepping order. */
  const sibling = (offset: -1 | 1): string | undefined => {
    const blockId = editor.getSelection();
    if (blockId === undefined) return undefined;
    const document = editor.getDocument();
    const parentId = reachableParent(blockId);
    const parent =
      parentId === undefined ? document.root : editor.getBlock(parentId);
    if (!parent || blockId === document.root.id) return undefined;
    const siblings = reachableChildren(parent);
    const index = siblings.findIndex((child) => child.id === blockId);
    return index === -1 ? undefined : siblings[index + offset]?.id;
  };

  /**
   * What Enter does: the first Block inside the selection, or the email's
   * first with nothing selected. Failing that, the selection's own text.
   */
  const stepIn = ():
    | { kind: "select"; blockId: string }
    | { kind: "edit"; blockId: string }
    | undefined => {
    const blockId = editor.getSelection();
    const block =
      blockId === undefined
        ? editor.getDocument().root
        : editor.getBlock(blockId);
    if (!block) return undefined;
    const first = reachableChildren(block)[0];
    if (first) return { kind: "select", blockId: first.id };
    if (blockId === undefined || isEditing()) return undefined;
    return richTextPropOf(editor.getDefinition(block.type)) === undefined
      ? undefined
      : { kind: "edit", blockId };
  };

  /** An Action that came about by a Command, whatever it calls. */
  const command = (act: () => boolean) => (): boolean =>
    actVia(editor, "command", act);

  return {
    undo: command(() => editor.undo()),
    redo: command(() => editor.redo()),

    delete: command(() => selected((blockId) => editor.removeBlock(blockId))),
    duplicate: command(() =>
      selected((blockId) => editor.duplicateBlock(blockId) !== undefined),
    ),

    moveUp: command(() => nudge(-1)),
    moveDown: command(() => nudge(1)),

    /**
     * Leave the text, keeping the Block selected.
     *
     * The Block becomes draggable again the moment this runs, which is the
     * point of it: an Author who has finished a sentence and wants to move the
     * paragraph has to be able to get their hands back on it without pressing
     * something else first.
     */
    stopEditing: command(() => isEditing() && editor.edit(undefined)),

    /**
     * Back out one level: the text, then the Block, then its parent, and at
     * last nothing. The root is never selected on the way.
     */
    stepOut: command(() => {
      if (isEditing()) return editor.edit(undefined);
      const blockId = editor.getSelection();
      if (blockId === undefined) return false;
      return editor.select(reachableParent(blockId));
    }),

    /** Go in one level, or start typing in a text Block with nothing in it. */
    selectFirstChild: command(() => {
      const step = stepIn();
      if (step === undefined) return false;
      return step.kind === "select"
        ? editor.select(step.blockId)
        : editor.edit(step.blockId);
    }),

    selectPrevious: command(() => {
      const target = sibling(-1);
      return target !== undefined && editor.select(target);
    }),

    selectNext: command(() => {
      const target = sibling(1);
      return target !== undefined && editor.select(target);
    }),

    can: {
      undo: () => editor.canUndo(),
      redo: () => editor.canRedo(),
      delete: () => selected((blockId) => editor.canRemove(blockId)),
      duplicate: () => selected((blockId) => editor.canDuplicate(blockId)),
      moveUp: () => canNudge(-1),
      moveDown: () => canNudge(1),
      stopEditing: isEditing,
      stepOut: () => isEditing() || editor.getSelection() !== undefined,
      selectFirstChild: () => stepIn() !== undefined,
      selectPrevious: () => sibling(-1) !== undefined,
      selectNext: () => sibling(1) !== undefined,
    },
  };
}
