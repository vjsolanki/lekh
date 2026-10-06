import type { BlockDefinition } from "lekh";
import { createReactEmailPreset } from "lekh/blocks";

import { callout } from "./your-callout";

/**
 * Let one of your own Blocks into a Preset's containers.
 *
 * `accepts` is an explicit list of types, not a wildcard. A Preset written
 * before your Block existed cannot name it, so a container will refuse it until
 * you say otherwise. That refusal is the feature working: it is the same rule
 * that stops a column landing inside a column.
 */
export function accepting(
  definitions: readonly BlockDefinition[],
  ...types: readonly string[]
): readonly BlockDefinition[] {
  return definitions.map((definition) =>
    // A leaf has no `accepts` and must not gain one: that would turn it into a
    // container.
    definition.accepts === undefined
      ? definition
      : { ...definition, accepts: [...definition.accepts, ...types] },
  );
}

export const definitions = [
  ...accepting(createReactEmailPreset(), callout.type),
  callout,
];
