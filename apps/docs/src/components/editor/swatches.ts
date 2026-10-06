/**
 * The colours already in this email, for the "In this email" row beside every
 * colour field.
 *
 * The example's own read, not lekh's: which colours an Author wants to reuse is
 * an Inspector's call. It walks the stored Document, so a drag in progress
 * shows up once it is let go.
 */

import { SchemaKind, type Block, type BlockDefinition } from "lekh-editor";

/** Hex in three or six digits, or `rgb()`, as an Agent may write one. */
const COLOR = /^(#[\da-f]{3}([\da-f]{3})?|rgb\([\d\s,.%]+\))$/iu;

/** One spelling per colour, so `#FFF` and `#ffffff` are one swatch. */
export function canonical(value: string): string {
  const color = value.trim().toLowerCase().replaceAll(/\s+/gu, "");
  return /^#[\da-f]{3}$/u.test(color)
    ? color.replaceAll(/[\da-f]/gu, "$&$&")
    : color;
}

/**
 * Every colour and Surface value stored in the tree under `root`, Mobile
 * Overrides included, once each in one spelling, in Document order. None,
 * anything that is not a hex or `rgb()` colour, and the Brand Colours already
 * offered in their own row are left out.
 */
export function colorsInEmail(
  root: Block,
  definitions: readonly BlockDefinition[],
  brand: readonly string[] = [],
): readonly string[] {
  const kinds = new Map(
    definitions.map((definition) => [
      definition.type,
      new Set(
        Object.entries(definition.schema)
          .filter(
            ([, entry]) =>
              entry.kind === SchemaKind.color ||
              entry.kind === SchemaKind.surface,
          )
          .map(([name]) => name),
      ),
    ]),
  );
  const skip = new Set(brand.map(canonical));
  const found = new Set<string>();
  const visit = (block: Block): void => {
    const colors = kinds.get(block.type);
    if (colors) {
      for (const values of [block.props, block.mobile ?? {}]) {
        for (const [name, value] of Object.entries(values)) {
          if (!colors.has(name) || typeof value !== "string") continue;
          if (!COLOR.test(value.trim())) continue;
          const color = canonical(value);
          if (!skip.has(color)) found.add(color);
        }
      }
    }
    for (const child of block.children ?? []) visit(child);
  };
  visit(root);
  return [...found];
}
