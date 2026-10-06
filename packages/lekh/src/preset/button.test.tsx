import { describe, expect, it } from "vitest";

import { createEditor, type EmailDocument } from "../index";
import { REACT_EMAIL_ROOT_TYPE } from "../blocks";
import { parseMarkup, styleOf } from "../testing/markup";
import {
  definitions,
  markup,
  stylesOf,
  alone,
  tagsWearingOverride,
} from "../testing/preset";

/** One button under the root, linked so it raises no Diagnostic. */
function buttonAlone(
  props: Record<string, unknown> = {},
  mobile?: Record<string, unknown>,
): EmailDocument {
  return alone({
    id: "subject",
    type: "button",
    props: { href: "https://example.com", ...props },
    ...(mobile ? { mobile } : {}),
  });
}

/** The style on the button's anchor. */
function anchorStyle(html: string): Readonly<Record<string, string>> {
  return stylesOf(html, "a[style]")[0] ?? {};
}

/** The cell the button's anchor sits in. */
function buttonCell(html: string): Element {
  const cell = parseMarkup(html).all("a")[0]?.parentElement;
  if (cell?.localName !== "td") throw new Error("No cell holds the button.");
  return cell;
}

/** The rule the button adds when it fills a phone's width. */
const FULL_WIDTH_RULE =
  ".lekh-button-full a{display:block!important;text-align:center!important}";

// #69: the button aligns, goes full width, and styles its border, padding and
// label. Every default matches the button as it looked before.
describe("the button's style", () => {
  const schema = definitions.find(
    (definition) => definition.type === "button",
  )?.schema;

  it("looks as it always has with none of the new props set", () => {
    const html = markup(buttonAlone());
    const style = anchorStyle(html);

    expect(style["padding-top"]).toBe("12px");
    expect(style["padding-right"]).toBe("20px");
    expect(style["padding-bottom"]).toBe("12px");
    expect(style["padding-left"]).toBe("20px");
    expect(style["border-radius"]).toBe("6px");
    expect(style["font-size"]).toBe("16px");
    expect(style["font-weight"]).toBe("400");
    expect(style["display"]).toBe("inline-block");
    expect(style).not.toHaveProperty("border");
    expect(style).not.toHaveProperty("letter-spacing");
    expect(buttonCell(html).getAttribute("align")).toBe("left");
    expect(html).not.toContain("lekh-button-full");
  });

  it("aligns on its cell, beside its padding and Mobile Override class", () => {
    const html = markup(
      buttonAlone({ align: "center", paddingLeft: 8 }, { align: "right" }),
    );
    const cell = buttonCell(html);

    expect(cell.getAttribute("align")).toBe("center");
    expect(styleOf(cell)).toMatchObject({
      "text-align": "center",
      "padding-left": "8px",
    });
    expect(cell.classList.contains("lekh-m-subject")).toBe(true);
    expect(html).toContain(".lekh-m-subject{text-align:right!important}");
    expect(tagsWearingOverride(html)).toEqual(["td"]);
  });

  it("offers alignment as an Overridable align control", () => {
    expect(schema?.["align"]).toMatchObject({
      kind: "align",
      defaultValue: "start",
      constraints: { options: ["start", "center", "end"] },
    });
    expect(schema?.["align"]).toHaveProperty("mobile");
  });

  it("writes its inner padding on the anchor", () => {
    const style = anchorStyle(
      markup(buttonAlone({ innerPaddingY: 8, innerPaddingX: 32 })),
    );

    expect(style["padding-top"]).toBe("8px");
    expect(style["padding-right"]).toBe("32px");
    expect(style["padding-bottom"]).toBe("8px");
    expect(style["padding-left"]).toBe("32px");
  });

  it("fills its column when full width, with the label centred", () => {
    const style = anchorStyle(markup(buttonAlone({ fullWidth: true })));

    expect(style["display"]).toBe("block");
    expect(style["text-align"]).toBe("center");
    expect(style["display"]).not.toBe("inline-block");
  });

  it("fills a phone's width with one rule, however many buttons ask", () => {
    const html = markup({
      root: {
        id: "root",
        type: REACT_EMAIL_ROOT_TYPE,
        props: {},
        children: ["one", "two"].map((id) => ({
          id,
          type: "button",
          props: { href: "https://example.com", fullWidthOnMobile: true },
        })),
      },
    });
    const media = html.indexOf("@media only screen and (max-width:480px)");

    expect(html.split(FULL_WIDTH_RULE)).toHaveLength(2);
    expect(media).toBeGreaterThan(-1);
    expect(html.indexOf(FULL_WIDTH_RULE)).toBeGreaterThan(media);
    expect(buttonCell(html).classList.contains("lekh-button-full")).toBe(true);
    // Still content width on a desktop.
    expect(anchorStyle(html)["display"]).toBe("inline-block");
  });

  it("writes a border, and none at width zero", () => {
    const bordered = anchorStyle(
      markup(
        buttonAlone({
          borderWidth: 2,
          borderStyle: "dashed",
          borderColor: "#ff0000",
          borderRadius: 0,
        }),
      ),
    );

    expect(bordered["border"]).toBe("2px dashed #ff0000");
    expect(bordered).not.toHaveProperty("border-radius");
    expect(
      Object.values(
        anchorStyle(markup(buttonAlone({ borderColor: "#ff0000" }))),
      ),
    ).not.toContainEqual(expect.stringContaining("#ff0000"));
  });

  it("styles its label's size, weight and letter spacing", () => {
    const style = anchorStyle(
      markup(buttonAlone({ fontSize: 20, fontWeight: 600, letterSpacing: 1 })),
    );

    expect(style["font-size"]).toBe("20px");
    expect(style["font-weight"]).toBe("600");
    expect(style["letter-spacing"]).toBe("1px");
  });

  it("snaps a stored weight off the list to the nearest one", () => {
    expect(
      anchorStyle(markup(buttonAlone({ fontWeight: 640 })))["font-weight"],
    ).toBe("600");
  });

  it("offers the new props with their ranges, only alignment Overridable", () => {
    expect(schema?.["innerPaddingY"]).toMatchObject({
      kind: "number",
      defaultValue: 12,
      constraints: { min: 0, max: 48, unit: "px" },
    });
    expect(schema?.["innerPaddingX"]).toMatchObject({
      kind: "number",
      defaultValue: 20,
      constraints: { min: 0, max: 48, unit: "px" },
    });
    expect(schema?.["fullWidth"]).toMatchObject({
      kind: "boolean",
      defaultValue: false,
    });
    expect(schema?.["fullWidthOnMobile"]).toMatchObject({
      kind: "boolean",
      defaultValue: false,
    });
    expect(schema?.["borderWidth"]).toMatchObject({ defaultValue: 0 });
    expect(schema?.["borderRadius"]).toMatchObject({
      defaultValue: 6,
      constraints: { min: 0, max: 32, unit: "px" },
    });
    expect(schema?.["fontSize"]).toMatchObject({
      kind: "number",
      defaultValue: 16,
      constraints: { min: 12, max: 32, unit: "px" },
    });
    expect(schema?.["fontWeight"]).toMatchObject({
      kind: "select",
      defaultValue: 400,
    });
    expect(schema?.["letterSpacing"]).toMatchObject({
      kind: "number",
      defaultValue: 0,
    });
    expect(schema).not.toHaveProperty("lineHeight");
    for (const name of [
      "innerPaddingY",
      "innerPaddingX",
      "fullWidth",
      "fullWidthOnMobile",
      "borderWidth",
      "borderStyle",
      "borderColor",
      "borderRadius",
      "fontSize",
      "fontWeight",
      "letterSpacing",
    ]) {
      expect(schema?.[name]).not.toHaveProperty("mobile");
    }
  });
});

// ADR-0040: the room round the label is a Box of its own, apart from the
// button's outer padding.
describe("the button's inner spacing", () => {
  const schema = definitions.find(
    (definition) => definition.type === "button",
  )?.schema;

  it("is its own Box, top and bottom on one prop and the sides on the other", () => {
    expect(schema?.["innerPaddingY"]).toMatchObject({
      box: "inner",
      side: ["top", "bottom"],
    });
    expect(schema?.["innerPaddingX"]).toMatchObject({
      box: "inner",
      side: ["left", "right"],
    });
  });

  it("leaves the outer padding a Box apart", () => {
    expect(schema?.["paddingTop"]).toMatchObject({
      box: "padding",
      side: "top",
    });
  });
});

describe("the button's Boxes in the Inspector", () => {
  it("reach its Control Descriptors", () => {
    const editor = createEditor({ definitions, document: buttonAlone() });
    editor.select("subject");
    const boxes = editor
      .getControls()
      .filter((control) => control.box !== undefined)
      .map(({ name, box, side }) => [name, box, side]);

    // The outer Box first: the Canvas takes the first declared as the outer.
    expect(boxes).toEqual([
      ["paddingTop", "padding", "top"],
      ["paddingRight", "padding", "right"],
      ["paddingBottom", "padding", "bottom"],
      ["paddingLeft", "padding", "left"],
      ["innerPaddingY", "inner", ["top", "bottom"]],
      ["innerPaddingX", "inner", ["left", "right"]],
    ]);
  });
});

describe("the button's label colour", () => {
  it("names the fill it sits on", () => {
    const schema = definitions.find(
      (definition) => definition.type === "button",
    )?.schema;

    expect(schema?.["color"]).toMatchObject({ on: "backgroundColor" });
  });

  it("is read against the fill in the Inspector", () => {
    const editor = createEditor({
      definitions,
      document: buttonAlone({ backgroundColor: "#0a7d3b" }),
    });
    editor.select("subject");

    expect(
      editor.getControls().find((control) => control.name === "color"),
    ).toMatchObject({ against: "#0a7d3b" });
  });
});

describe("the button's corner radius", () => {
  const radiusOf = (props: Record<string, unknown>) => {
    const editor = createEditor({ definitions, document: buttonAlone(props) });
    editor.select("subject");
    return editor
      .getControls()
      .find((control) => control.name === "borderRadius");
  };

  it("notes that Outlook for Windows shows square corners", () => {
    expect(radiusOf({ borderRadius: 6 })?.clients).toEqual([
      { client: "outlook-windows", note: "Shows square corners" },
    ]);
  });

  it("notes nothing when the corners are square anyway", () => {
    expect(radiusOf({ borderRadius: 0 })).not.toHaveProperty("clients");
  });
});
