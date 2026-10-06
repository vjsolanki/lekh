import { type Editor, renderDocument, toHtml } from "lekh";

/**
 * The email as markup a mail client will accept.
 *
 * `getRenderOptions()` passes your Definitions and checks straight through, so
 * the editor and the finished HTML cannot disagree about what is valid.
 */
export function toSendableHtml(editor: Editor): string {
  return toHtml(
    renderDocument(editor.getDocument(), editor.getRenderOptions()),
  );
}

/**
 * The same email, for a preview pane.
 *
 * `validate: false` because a half-finished email is the normal state of one
 * somebody is still writing. A preview that throws is a preview that is blank
 * for the whole time it is being worked on.
 */
export function toPreviewHtml(editor: Editor): string {
  return toHtml(
    renderDocument(editor.getDocument(), {
      ...editor.getRenderOptions(),
      validate: false,
    }),
  );
}
