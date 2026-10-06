import { DOMParser } from "linkedom";
import { createElement, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  renderDocument,
  toHtml,
  type EmailDocument,
  type RenderDocumentOptions,
} from "../index";

import { definitions } from "./blocks";

/**
 * Rendered markup, parsed, so a test asks for elements rather than matching
 * text.
 *
 * A regular expression over HTML fails when an attribute moves or a space
 * appears, and neither changes what an inbox shows. A selector does not care.
 */
export interface Markup {
  readonly document: Document;
  /** Every element the selector matches, in document order. */
  all(selector: string): readonly Element[];
  /** The one element the selector matches. Throws on none, or on several. */
  one(selector: string): Element;
}

/**
 * A Document through the render path, without the doctype.
 *
 * The test Blocks unless other Definitions are passed.
 */
export function markupOf(
  document: EmailDocument,
  options: Partial<RenderDocumentOptions> = {},
): string {
  return toHtml(renderDocument(document, { definitions, ...options }), {
    doctype: false,
  });
}

/**
 * Any React node as static markup: a Block's own render, a stand-in, or the
 * tree the Canvas draws.
 *
 * `markupOf` is for a whole Document on the render path. This is for the parts
 * a test reaches without one.
 */
export function markupOfNode(node: ReactNode): string {
  return renderToStaticMarkup(createElement(Fragment, null, node));
}

/**
 * The mobile stylesheet in rendered markup: the text of its `<style>`, or
 * nothing when there is none. The Canvas draws one too.
 */
export function stylesheetOf(html: string): string {
  return parseMarkup(html).all("style")[0]?.textContent ?? "";
}

/** Parse markup: a whole email, a `<body>`, or a fragment. */
export function parseMarkup(html: string): Markup {
  // linkedom implements the DOM but types it with classes of its own, so the
  // tests read it through the standard types instead.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const parsed = new DOMParser().parseFromString(
    asDocument(html),
    "text/html",
  ) as unknown as Document;

  const all = (selector: string): readonly Element[] => [
    ...parsed.querySelectorAll(selector),
  ];

  return {
    document: parsed,
    all,
    one(selector) {
      const found = all(selector);
      const [only] = found;
      if (only === undefined) {
        throw new Error(`No element matches "${selector}".`);
      }
      if (found.length > 1) {
        throw new Error(
          `${String(found.length)} elements match "${selector}", not one.`,
        );
      }
      return only;
    },
  };
}

/**
 * The markup only Outlook reads, parsed.
 *
 * Every `<!--[if mso]>…<![endif]-->` section, joined in order. A section is
 * often half an element — the opening of a VML rectangle in one, its close in
 * another, with every client's markup between — so the halves are read
 * together and close up into whole elements. What sits between them is not
 * included: every client reads that, and `parseMarkup` already has it.
 *
 * `<!--[if !mso]>` sections are the opposite and are left out.
 */
export function outlookMarkup(html: string): Markup {
  const sections = [...html.matchAll(OUTLOOK_SECTION)]
    .filter(([, condition]) => condition !== undefined && isOutlook(condition))
    .map(([, , inner]) => inner ?? "");
  return parseMarkup(sections.join(""));
}

/**
 * An element's inline style as a map of property to value.
 *
 * Property names are lowercased, and space around and within values is
 * collapsed, so two styles that say the same thing compare equal whatever
 * their order and spacing. A `;` inside quotes or brackets stays part of its
 * value.
 */
export function styleOf(element: Element): Readonly<Record<string, string>> {
  const style: Record<string, string> = {};
  for (const declaration of declarationsOf(
    element.getAttribute("style") ?? "",
  )) {
    const colon = declaration.indexOf(":");
    if (colon === -1) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration
      .slice(colon + 1)
      .trim()
      .replaceAll(/\s+/gu, " ");
    if (property !== "") style[property] = value;
  }
  return style;
}

/** A downlevel-hidden conditional comment: its condition, then its contents. */
const OUTLOOK_SECTION = /<!--\[if ([^\]]*)\]>([\s\S]*?)<!\[endif\]-->/gu;

/** A condition Outlook meets: one naming `mso` that is not `!mso`. */
function isOutlook(condition: string): boolean {
  return /\bmso\b/u.test(condition) && !/!\s*mso\b/u.test(condition);
}

/**
 * Markup as a whole document, so the parser keeps what it is given.
 *
 * Without an `<html>` around it, the attributes of a `<body>` the test Blocks
 * render would be lost.
 */
function asDocument(html: string): string {
  if (/<html[\s>]/iu.test(html)) return html;
  if (/<body[\s>]/iu.test(html)) return `<html>${html}</html>`;
  return `<html><body>${html}</body></html>`;
}

/** A style attribute split on the semicolons that end a declaration. */
function declarationsOf(style: string): readonly string[] {
  const declarations: string[] = [];
  let current = "";
  let quote: string | undefined;
  let depth = 0;
  for (const character of style) {
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth = Math.max(0, depth - 1);
    } else if (character === ";" && depth === 0) {
      declarations.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  declarations.push(current);
  return declarations;
}
