import { createEditor } from "lekh-editor";
import { createReactEmailPreset } from "lekh-editor/blocks";

import {
  createHouseFooterPreset,
  DISCLAIMER_TYPE,
  EMPTY_DISCLAIMER,
  PREFERENCES_TYPE,
} from "./custom-compliance";
import { accepting } from "./preset-plus-your-block";

const footer = createHouseFooterPreset({
  preferencesUrl: "%%preferences_link%%",
  disclaimer: "Acme Inc is authorised and regulated by the FCA.",
});

/**
 * The root has to accept a Required Block, because that is where a repair puts
 * it back. `createEditor` throws `EditorConfigurationError` if it does not.
 */
const definitions = [
  ...accepting(createReactEmailPreset(), PREFERENCES_TYPE, DISCLAIMER_TYPE),
  ...footer,
];

export const editor = createEditor({
  definitions,
  // Your codes work here like any other. This one makes an empty disclaimer
  // block the send.
  severities: { [EMPTY_DISCLAIMER]: "error" },
});
