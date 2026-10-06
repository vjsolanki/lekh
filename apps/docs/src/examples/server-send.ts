import {
  DocumentValidationError,
  type EmailDocument,
  renderDocument,
  toHtml,
  UnknownBlockError,
} from "lekh-editor";
import { createReactEmailPreset } from "lekh-editor/blocks";

// Built once per process, not per request.
const definitions = createReactEmailPreset();

/**
 * Turn a saved email into HTML, on a server.
 *
 * Nothing here needs a browser and nothing imports the editor, so this is safe
 * in a Server Component, a route handler, a queue worker or an edge function.
 */
export function emailToHtml(document: EmailDocument): string {
  return toHtml(renderDocument(document, { definitions }));
}

/** The same thing, reporting why it refused instead of throwing. */
export function trySend(
  document: EmailDocument,
): { ok: true; html: string } | { ok: false; reason: string } {
  try {
    return { ok: true, html: emailToHtml(document) };
  } catch (error) {
    if (error instanceof DocumentValidationError) {
      const blocking = error.diagnostics.filter((d) => d.severity === "error");
      return { ok: false, reason: blocking.map((d) => d.code).join(", ") };
    }
    if (error instanceof UnknownBlockError) {
      return { ok: false, reason: `unknown block type ${error.blockType}` };
    }
    throw error;
  }
}
