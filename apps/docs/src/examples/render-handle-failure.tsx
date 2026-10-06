import {
  DocumentValidationError,
  type EmailDocument,
  renderDocument,
  toHtml,
  UnknownBlockError,
} from "lekh";
import { createReactEmailPreset } from "lekh/blocks";

const definitions = createReactEmailPreset();

/** The HTML to send, or `undefined` if this email must not go out. */
export function toSendableHtml(document: EmailDocument): string | undefined {
  try {
    return toHtml(renderDocument(document, { definitions }));
  } catch (error) {
    if (error instanceof DocumentValidationError) {
      for (const diagnostic of error.diagnostics) {
        if (diagnostic.severity !== "error") continue;
        console.error(`[${diagnostic.code}] ${diagnostic.message}`);
      }
      return undefined;
    }

    if (error instanceof UnknownBlockError) {
      console.error(
        `Block ${error.blockId} has type "${error.blockType}", which is not in your definitions.`,
      );
      return undefined;
    }

    throw error;
  }
}
