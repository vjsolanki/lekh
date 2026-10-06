import type { Registry } from "../document/registry";
import { richTextPropOf, textShapeOf } from "../document/definition";
import type { Block, EmailDocument } from "../document/document";
import { sanitiseInlineMarkup } from "../markup/inline-markup";
import { applyOp, type Op } from "./op";
import type { TextEngine } from "./text-engine";
import { findBlock, replaceBlock } from "../document/tree";

export interface StoreSetup {
  readonly document: EmailDocument;
  readonly registry: Registry;
  readonly textEngine?: TextEngine;
}

/**
 * The Document, and the only thing that changes it.
 *
 * One rule, in one place: **a `text-edit` writes text, and every other Op
 * writes structure.** The second half is ADR-0004 — every change to a Document
 * is a typed, serialisable Op. The first is ADR-0009's deliberate exception to
 * it, confined to the value of one Block's rich-text prop, and this boundary
 * is where that exception is stated rather than something a reader has to
 * reconstruct from the middle of a longer function.
 *
 * It settles the Document and nothing else. Selection, Diagnostics and
 * outstanding Image Requests all react to a change here, and all of them
 * belong to whoever owns them.
 */
export interface Store {
  /** The Document as it now reads. */
  get(): EmailDocument;
  /** The Block with this id, anywhere in the Document. */
  block(id: string): Block | undefined;
  /**
   * Apply Ops in order.
   *
   * `direction` is how a `text-edit` marker is carried out: undoing one
   * delegates to the engine for that Block and then reads back what it says,
   * because the marker carries no text of its own. Leave it out for ordinary
   * forward application, where there is nothing to delegate and the engine has
   * already changed the text this marker is recording.
   */
  apply(ops: readonly Op[], direction?: "undo" | "redo"): void;
}

export function createStore(setup: StoreSetup): Store {
  let document = setup.document;

  /**
   * Bring a Block's stored text back in line with the engine.
   *
   * Done outside the Op log on purpose (ADR-0009): the marker orders the
   * change in history, and this puts the result where a Consumer's save can
   * find it. A second Op would mean two undo entries for one action.
   */
  const withEngineText = (root: Block, blockId: string): Block => {
    const engine = setup.textEngine;
    if (!engine) return root;
    const block = findBlock(root, blockId);
    if (!block) return root;

    const definition = setup.registry.get(block.type);
    const prop = richTextPropOf(definition);
    if (prop === undefined) return root;

    const content = engine.getText(blockId);
    if (content === undefined) return root;

    // Sanitised here as well as at the paste, because the store cannot know
    // what an engine it has never met will hand back.
    const sanitised = sanitiseInlineMarkup(content, textShapeOf(definition));
    if (block.props[prop] === sanitised) return root;

    return replaceBlock(root, {
      ...block,
      props: { ...block.props, [prop]: sanitised },
    });
  };

  return {
    get: () => document,
    block: (id) => findBlock(document.root, id),

    apply(ops, direction) {
      let root = document.root;
      for (const op of ops) {
        if (op.kind === "text-edit") {
          if (direction === "undo") setup.textEngine?.undo(op.blockId);
          else if (direction === "redo") setup.textEngine?.redo(op.blockId);
          root = withEngineText(root, op.blockId);
        } else {
          root = applyOp(root, op);
        }
      }
      if (root !== document.root) document = { root };
    },
  };
}
