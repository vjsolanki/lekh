import type { Diagnostic, ValidationContext } from "./diagnostic";
import type { Block } from "../document/document";
import { validatedProps } from "../document/props";

/**
 * Whether a value says nothing, for a Validator that wanted text.
 *
 * Whitespace is not a label, and it is not an address, a link or alternative
 * text either; nor is anything that is not text at all. One predicate rather
 * than one per Preset, because the two this replaces had drifted: `"   "` was
 * an empty unsubscribe label and a working button link at the same time, and a
 * `null` href read as a link that goes somewhere.
 */
export function isBlank(value: unknown): boolean {
  return typeof value !== "string" || value.trim() === "";
}

/**
 * One finding when a Block's prop resolves to nothing, and none otherwise. It
 * names the Block and the prop.
 */
export function missingProp(
  block: Block,
  context: ValidationContext,
  prop: string,
  finding: Omit<Diagnostic, "blockId" | "prop">,
): Diagnostic[] {
  return isBlank(validatedProps(block, context)[prop])
    ? [{ ...finding, blockId: block.id, prop }]
    : [];
}
