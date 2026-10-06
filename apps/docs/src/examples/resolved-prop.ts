import type { Block, ValidationContext } from "lekh";

/**
 * What a prop actually says, for a check that has to judge it.
 *
 * `block.props` holds only what somebody set. A prop nobody touched is absent,
 * and an absent prop means the Schema default — so reading the stored value
 * alone reports every untouched Block as empty.
 */
export function resolvedProp(
  block: Block,
  context: ValidationContext,
  prop: string,
): unknown {
  const stored = block.props[prop];
  if (stored !== undefined) return stored;
  return context.getDefinition(block.type)?.schema[prop]?.defaultValue;
}
