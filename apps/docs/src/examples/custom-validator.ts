import { isBlank } from "lekh-editor";
import type { Block, Diagnostic, SetPropRepair, Validator } from "lekh-editor";

import { resolvedProp } from "./resolved-prop";

/** Your code. Export it, and match on this rather than on the wording. */
export const INSECURE_LINK = "insecure-link";
/** A second one, for a rule with no fix anything could apply. */
export const PLACEHOLDER_LEFT_IN = "placeholder-left-in";

const INSECURE = "http://";

/**
 * Every link goes over https, and no email ships with `TODO` still in it.
 *
 * A Validator is a plain function of a Document. It reports; it changes
 * nothing.
 */
export const houseStyle: Validator = (document, context) => {
  const found: Diagnostic[] = [];

  for (const block of everyBlock(document.root)) {
    // Say nothing about a Block this editor does not understand. Its props
    // mean whatever the Definition you are missing said they meant, and the
    // Document already reports it as unrenderable.
    if (!context.getDefinition(block.type)) continue;

    const href = resolvedProp(block, context, "href");
    if (typeof href === "string" && href.startsWith(INSECURE)) {
      // Describe the fix rather than perform it. Only `editor.applyRepair`
      // ever carries one out.
      const repair: SetPropRepair = {
        kind: "set-prop",
        blockId: block.id,
        prop: "href",
        value: `https://${href.slice(INSECURE.length)}`,
      };

      found.push({
        code: INSECURE_LINK,
        message: "This link is not encrypted. Some mail clients warn about it.",
        severity: "warning",
        blockId: block.id,
        repair,
      });
    }

    const text = resolvedProp(block, context, "text");
    if (!isBlank(text) && String(text).includes("TODO")) {
      found.push({
        code: PLACEHOLDER_LEFT_IN,
        // No repair: nothing here knows what the words were meant to be.
        message: "This text still says TODO.",
        severity: "error",
        blockId: block.id,
      });
    }
  }

  return found;
};

/** Depth-first. A Block's `children` is absent on a leaf, not empty. */
function* everyBlock(block: Block): Generator<Block> {
  yield block;
  for (const child of block.children ?? []) yield* everyBlock(child);
}
