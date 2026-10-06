import { describe, expect, it } from "vitest";

import { sanitiseHtml, sanitiseInlineMarkup } from "../../index";
import { SAFE_LINKS, SCRIPTABLE_LINKS } from "../../testing/attacks";
import { definitionsResponsive } from "../../testing/blocks";
import { markupOf, stylesheetOf } from "../../testing/markup";
import { block, documentOf, onMobile } from "../../testing/tree";

/**
 * One attack table, through both public sanitisers and the mobile stylesheet.
 * The rules themselves are in `core/markup-safety.unit.test.ts`.
 */

describe("a link that could run script", () => {
  it.each(SCRIPTABLE_LINKS)(
    "is dropped from rich text with %s, and its words kept",
    (_, href) => {
      expect(sanitiseInlineMarkup(`<a href="${href}">click</a>`)).toBe("click");
    },
  );

  it.each(SCRIPTABLE_LINKS)(
    "is dropped from an HTML Block with %s, and its words kept",
    (_, href) => {
      expect(sanitiseHtml(`<a href="${href}">click</a>`, "lekh-h-x")).toBe(
        "<a>click</a>",
      );
    },
  );
});

describe("a link an email may carry", () => {
  it.each(SAFE_LINKS)("passes through rich text unchanged: %s", (href) => {
    expect(sanitiseInlineMarkup(`<a href="${href}">x</a>`)).toBe(
      `<a href="${href}">x</a>`,
    );
  });

  it.each(SAFE_LINKS)("passes through an HTML Block unchanged: %s", (href) => {
    expect(sanitiseHtml(`<a href="${href}">x</a>`, "lekh-h-x")).toBe(
      `<a href="${href}">x</a>`,
    );
  });
});

/**
 * The mobile stylesheet of an email whose one text Block overrides its size.
 *
 * Validation is off. A string where a number goes is a `prop-wrong-shape`
 * error that stops a validated render, and this is the CSS check that still
 * stands when nothing validated.
 */
function stylesheetWith(fontSize: unknown): string {
  return stylesheetOf(
    markupOf(
      documentOf(
        block("email", {}, [
          onMobile(block("text", { id: "copy" }), { fontSize }),
        ]),
      ),
      { definitions: definitionsResponsive, validate: false },
    ),
  );
}

describe("a Mobile Override and the CSS check", () => {
  it("emits its declaration when it passes", () => {
    expect(stylesheetWith(18)).toContain(
      ".lekh-m-copy{font-size:18px!important}",
    );
  });

  it.each([
    ["an expression", "expression(alert(1))"],
    ["a javascript url", "url(javascript:alert(1))"],
    ["a second declaration", "1px;behavior:url(x.htc);x:"],
    ["a brace that closes the rule", "1px}body{display:none"],
  ])("emits no declaration for %s", (_, fontSize) => {
    expect(stylesheetWith(fontSize)).not.toContain("font-size");
  });
});
