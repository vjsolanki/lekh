import type { BlockDefinition } from "../core/document/definition";
import type { PresetDefaults } from "./options";

/**
 * One Block a Consumer may list for `pickReactEmailPreset`, with any
 * Structural Block it owns.
 *
 * Opaque: what it builds is the Preset's business. Only its type shows, so a
 * message can name it.
 */
export interface ReactEmailBlock {
  /** The type the Block registers. */
  readonly type: string;
}

/** What a {@link ReactEmailBlock} is inside the Preset. */
interface BlockEntry extends ReactEmailBlock {
  /** The Block's Definitions, its Structural child after it. */
  readonly definitions: (config: PresetDefaults) => readonly BlockDefinition[];
}

/**
 * A Block a Consumer may list.
 *
 * A plain object rather than a registration, so that an entry nobody lists is
 * code nothing reaches, and the bundler drops it.
 */
export function presetBlock(
  type: string,
  definitions: BlockEntry["definitions"],
): ReactEmailBlock {
  const entry: BlockEntry = { type, definitions };
  return entry;
}

/**
 * The Definitions each listed Block builds, in the order listed.
 *
 * It throws on an entry that is not one of the Preset's Blocks, and on one
 * listed twice, where the Consumer sees it.
 */
export function definitionsOf(
  blocks: readonly ReactEmailBlock[],
  config: PresetDefaults,
): BlockDefinition[] {
  const listed = new Set<string>();
  return blocks.flatMap((block) => {
    if (!isEntry(block)) {
      throw new Error(
        `${JSON.stringify(block) ?? typeof block} is not a Block from lekh/blocks. ` +
          "List the Blocks it exports, such as textBlock.",
      );
    }
    if (listed.has(block.type)) {
      throw new Error(`The Block "${block.type}" is listed twice.`);
    }
    listed.add(block.type);
    return block.definitions(config);
  });
}

function isEntry(value: unknown): value is BlockEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string" &&
    "definitions" in value &&
    typeof value.definitions === "function"
  );
}
