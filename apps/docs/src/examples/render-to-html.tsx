import { type EmailDocument, renderDocument, toHtml } from "lekh-editor";
import { createReactEmailPreset } from "lekh-editor/blocks";

const definitions = createReactEmailPreset();

export function emailToHtml(document: EmailDocument): string {
  return toHtml(renderDocument(document, { definitions }));
}
