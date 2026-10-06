import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

export interface ToHtmlOptions {
  /** Prepend the HTML doctype that mail clients expect. Defaults to `true`. */
  doctype?: boolean;
}

/**
 * Stringify a rendered element to HTML.
 *
 * Offered as a convenience, not a requirement — `renderDocument` stops at a
 * React element so a Consumer can reach for any stringifier they prefer.
 *
 * Uses `renderToStaticMarkup`, so the output carries no hydration markers —
 * mail clients receive plain HTML.
 *
 * React 19 puts a `<link rel="preload">` in the head for every image. A mail
 * client has nothing to preload, and React 18 writes none, so they go: the
 * same email is the same bytes whichever React the Consumer runs.
 */
export function toHtml(
  element: ReactElement,
  options: ToHtmlOptions = {},
): string {
  const { doctype = true } = options;
  const markup = renderToStaticMarkup(element).replaceAll(
    /<link rel="preload" as="image"[^>]*\/>/gu,
    "",
  );

  return doctype
    ? `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">${markup}`
    : markup;
}
