import { type EmailDocument, renderDocument, toHtml } from "lekh";
import { createReactEmailPreset } from "lekh/blocks";

const definitions = createReactEmailPreset();

export function emailToHtml(document: EmailDocument): string {
  return toHtml(renderDocument(document, { definitions }));
}
