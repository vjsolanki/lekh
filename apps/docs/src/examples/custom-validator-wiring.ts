import { createEditor, minimumFontSize, renderDocument, toHtml } from "lekh";

import { houseStyle, INSECURE_LINK } from "./custom-validator";
import { definitions } from "./preset-plus-your-block";

/** Yours sit beside the shipped ones. Order does not matter. */
export const editor = createEditor({
  definitions,
  validators: [houseStyle, minimumFontSize({ minimum: 14 })],
  // Keyed by code, so you can escalate a check you did not write.
  severities: { [INSECURE_LINK]: "error" },
});

/**
 * The same checks at send time.
 *
 * `getRenderOptions()` carries the Definitions, the Validators and the severity
 * map together, so the editor and the render path cannot disagree about what is
 * wrong with an email.
 */
export function emailToHtml(): string {
  return toHtml(
    renderDocument(editor.getDocument(), editor.getRenderOptions()),
  );
}
