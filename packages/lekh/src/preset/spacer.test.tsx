import { describe, expect, it } from "vitest";

import { NONE, SchemaKind, type EmailDocument } from "../index";
import { REACT_EMAIL_ROOT_TYPE } from "../blocks";
import { parseMarkup, styleOf } from "../testing/markup";
import {
  markup,
  alone,
  tagsWearingOverride,
  outermost,
  overriddenCell,
  definitionOf,
} from "../testing/preset";

/** The spacer's one cell. */
function spacerCell(html: string): Element {
  return parseMarkup(html).one("td[style*='mso-line-height-rule']");
}

const spacerAlone = (
  props: Record<string, unknown>,
  mobile?: Record<string, unknown>,
): EmailDocument =>
  alone(
    { id: "subject", type: "spacer", props, ...(mobile ? { mobile } : {}) },
    { backgroundColor: "none" },
  );

// #76: a blank gap between Blocks, a height and an optional colour.
describe("the spacer Block", () => {
  it("is called Spacer and holds a height, a color and showOn, no padding", () => {
    const definition = definitionOf("spacer");

    expect(definition?.label).toBe("Spacer");
    expect(Object.keys(definition?.schema ?? {})).toEqual([
      "height",
      "backgroundColor",
      "showOn",
    ]);
    expect(definition?.schema["height"]).toMatchObject({
      kind: "number",
      defaultValue: 24,
      constraints: { min: 4, max: 160, unit: "px" },
    });
    expect(definition?.schema["height"]?.mobile?.(12, {})).toEqual({
      height: "12px",
      "line-height": "12px",
    });
    expect(definition?.schema["backgroundColor"]).toMatchObject({
      kind: SchemaKind.surface,
      defaultValue: NONE,
    });
  });

  it("can go under the root, in a section and in a column", () => {
    for (const type of [REACT_EMAIL_ROOT_TYPE, "section", "column"]) {
      expect(definitionOf(type)?.accepts).toContain("spacer");
    }
  });

  it("renders one full-width cell, 24px tall, that holds a space", () => {
    const html = markup(spacerAlone({}));
    const table = outermost(html);
    const cell = parseMarkup(html).one('td[height="24"]');

    expect(table?.localName).toBe("table");
    expect(table?.getAttribute("role")).toBe("presentation");
    expect(table?.getAttribute("width")).toBe("100%");
    expect(cell.children).toHaveLength(0);
    expect(cell.textContent).toBe("\u00A0");
    const style = styleOf(cell);
    expect(style).toMatchObject({
      height: "24px",
      "line-height": "24px",
      "font-size": "0",
      "mso-line-height-rule": "exactly",
    });
    expect(style).not.toHaveProperty("background-color");
  });

  it("paints its color on the cell", () => {
    const html = markup(spacerAlone({ backgroundColor: "#101010" }));

    expect(styleOf(spacerCell(html))["background-color"]).toBe("#101010");
  });

  it("shrinks on a phone through a class on its cell", () => {
    const html = markup(spacerAlone({ height: 48 }, { height: 12 }));

    expect(html).toContain(
      ".lekh-m-subject{height:12px!important;line-height:12px!important}",
    );
    expect(tagsWearingOverride(html)).toEqual(["td"]);
    expect(overriddenCell(html).getAttribute("height")).toBe("48");
  });

  it("hides its whole table on a phone when desktop only", () => {
    const html = markup(spacerAlone({ showOn: "desktop" }));

    expect(outermost(html)?.localName).toBe("table");
    expect(outermost(html)?.getAttribute("class")).toBe("lekh-hidden");
  });
});
