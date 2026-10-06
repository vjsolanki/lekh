import { defineBlock } from "../core/document/definition";
import {
  band,
  BAND_VERSIONS,
  type BandProps,
  surfaceSchema,
  validateContentBackground,
} from "./band";
import { BLOCK_TYPE, LEAF_TYPES } from "./names";
import type { PresetDefaults } from "./options";
import { borderSchema, CONTENT_GROUP, MOBILE_GROUP, SHOW_ON } from "./schema";

/** A band of content across the email, drawn as the band (see `band`). */
export function sectionDefinition(config: PresetDefaults) {
  return defineBlock<BandProps>({
    type: BLOCK_TYPE.section,
    label: "Section",
    accepts: [BLOCK_TYPE.columns, ...LEAF_TYPES],
    ...BAND_VERSIONS,
    schema: {
      ...surfaceSchema("Section"),
      // Round the content, like the row's: a border at the window's edges is
      // two lines nobody can see the ends of (#70).
      ...borderSchema(CONTENT_GROUP),
      showOn: { ...SHOW_ON, group: MOBILE_GROUP },
    },
    validate: validateContentBackground,
    render: (context) => band(context, config, context.children),
  });
}
