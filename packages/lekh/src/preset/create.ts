import {
  SchemaKind,
  type BlockDefinition,
  type Preset,
} from "../core/document/definition";
import { definitionsOf, type ReactEmailBlock } from "./block";
import { buttonBlock } from "./button";
import { columnsBlock } from "./columns";
import { dividerBlock } from "./divider";
import { emailDefinition } from "./email";
import { headingBlock } from "./heading";
import { htmlBlock } from "./html";
import { iconRowBlock } from "./icon-row";
import { imageBlock } from "./image";
import { navBlock } from "./nav";
import type { BrandColor } from "../core/document/color";
import { presetDefaults, type ReactEmailPresetOptions } from "./options";
import { sectionDefinition } from "./section";
import { spacerBlock } from "./spacer";
import { textBlock } from "./text";

/**
 * Build the built-in Block Definitions, every Block among them.
 *
 * A factory rather than a constant because a Preset must be configurable
 * where it must be — otherwise every product with its own typography ends up
 * maintaining a fork.
 */
export function createReactEmailPreset(
  options: ReactEmailPresetOptions = {},
): Preset {
  return pickReactEmailPreset(
    [
      columnsBlock,
      headingBlock,
      textBlock,
      imageBlock,
      buttonBlock,
      dividerBlock,
      spacerBlock,
      htmlBlock,
      iconRowBlock,
      navBlock,
    ],
    options,
  );
}

/**
 * Build only the listed Blocks, so the rest never reach the bundle.
 *
 * Its own function rather than an optional list on `createReactEmailPreset`:
 * a factory whose default is every Block reaches every Block, and the bundler
 * cannot tell that a call passing a list never takes that default.
 *
 * The email and the section are always in, because without them no Document
 * is valid. A Structural Block comes with its owner and is never listed.
 */
export function pickReactEmailPreset(
  blocks: readonly ReactEmailBlock[],
  options: ReactEmailPresetOptions = {},
): Preset {
  const config = presetDefaults(options);
  return [
    emailDefinition(config),
    sectionDefinition(config),
    ...definitionsOf(blocks, config),
  ].map((definition) => offeringBrandColors(definition, config.colors));
}

/**
 * A Definition whose every colour and Surface entry offers the Brand Colours
 * as `constraints.brandColors`.
 *
 * Added here, once, rather than by each Block, so no colour can be missed. A
 * Definition with no colour entry, or a Preset with no Brand Colours, comes
 * back as it was.
 */
function offeringBrandColors(
  definition: BlockDefinition,
  brandColors: readonly BrandColor[],
): BlockDefinition {
  if (brandColors.length === 0) return definition;
  const schema = Object.fromEntries(
    Object.entries(definition.schema).map(([name, entry]) => [
      name,
      entry.kind === SchemaKind.color || entry.kind === SchemaKind.surface
        ? { ...entry, constraints: { ...entry.constraints, brandColors } }
        : entry,
    ]),
  );
  return { ...definition, schema };
}
