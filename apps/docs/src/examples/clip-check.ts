import {
  clipCheck,
  type EmailDocument,
  renderDocument,
  toHtml,
} from "lekh-editor";
import { createReactEmailPreset } from "lekh-editor/blocks";

const definitions = createReactEmailPreset();

// Measure the HTML you really send: add your tracking and footer first.
export function checkSize(document: EmailDocument): string | undefined {
  const html = toHtml(renderDocument(document, { definitions }));
  const { bytes, limit, risk } = clipCheck(html);
  if (risk === "ok") return undefined;
  return `This email is ${String(bytes)} of ${String(limit)} bytes. Gmail clips it past the limit.`;
}
