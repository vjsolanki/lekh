import { type EmailDocument, renderDocument, toHtml } from "lekh-editor";
import { createReactEmailPreset } from "lekh-editor/blocks";

const definitions = createReactEmailPreset();

// A half-finished email is normal while someone is editing, so skip the checks
// and leave out the doctype the browser does not need.
export function toPreviewHtml(document: EmailDocument): string {
  return toHtml(renderDocument(document, { definitions, validate: false }), {
    doctype: false,
  });
}
