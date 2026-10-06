import { describe, expect, it } from "vitest";

import { createEditor, SchemaKind, type Block } from "../index";
import { createCompliancePreset, REACT_EMAIL_ROOT_TYPE } from "../blocks";
import { parseMarkup, styleOf, stylesheetOf } from "../testing/markup";
import {
  definitions,
  markup,
  stylesOf,
  alone,
  tagsWearingOverride,
  paragraphStyles,
  placed,
  outermost,
  overriddenCell,
  PADDED,
  unchecked,
} from "../testing/preset";

/** The style on the heading's `<h1>`, `<h2>` or `<h3>`. */
function headingStyle(html: string): Readonly<Record<string, string>> {
  return stylesOf(html, "h1[style], h2[style], h3[style]")[0] ?? {};
}

/** The style a heading or text Block writes on its text, with these props. */
function typographyStyles(
  type: string,
  props: Record<string, unknown>,
  render = markup,
): readonly Readonly<Record<string, string>>[] {
  const html = render(
    alone({ id: "copy", type, props: { content: "Words", ...props } }),
  );
  return type === "heading" ? [headingStyle(html)] : paragraphStyles(html);
}

// #68: heading and text set their line height, weight and letter spacing.
describe("heading and text typography", () => {
  describe.each(["heading", "text"])("the %s Block", (type) => {
    it("writes a line height as a whole percentage, for classic Outlook", () => {
      for (const style of typographyStyles(type, { lineHeight: 1.15 })) {
        expect(style?.["line-height"]).toBe("115%");
      }
    });

    it("writes a weight as a number", () => {
      for (const style of typographyStyles(type, { fontWeight: 300 })) {
        expect(style?.["font-weight"]).toBe("300");
      }
    });

    it("writes a letter spacing in px", () => {
      for (const style of typographyStyles(type, { letterSpacing: 1.5 })) {
        expect(style?.["letter-spacing"]).toBe("1.5px");
      }
    });

    it("writes no letter spacing at zero", () => {
      for (const style of typographyStyles(type, {})) {
        expect(style).not.toHaveProperty("letter-spacing");
      }
    });

    it("clamps a stored value out of range", () => {
      const [high] = typographyStyles(type, {
        lineHeight: 3,
        letterSpacing: 20,
      });
      const [low] = typographyStyles(type, {
        lineHeight: 0.5,
        letterSpacing: -5,
      });

      expect(high?.["line-height"]).toBe("200%");
      expect(high?.["letter-spacing"]).toBe("10px");
      expect(low?.["line-height"]).toBe("100%");
      expect(low?.["letter-spacing"]).toBe("-2px");
    });

    it("snaps a stored weight off the list to the nearest one", () => {
      expect(
        typographyStyles(type, { fontWeight: 640 })[0]?.["font-weight"],
      ).toBe("600");
      expect(
        typographyStyles(type, { fontWeight: 1000 })[0]?.["font-weight"],
      ).toBe("800");
      expect(
        typographyStyles(type, { fontWeight: 100 })[0]?.["font-weight"],
      ).toBe("300");
    });

    it("offers the three props, none of them Overridable", () => {
      const schema = definitions.find(
        (definition) => definition.type === type,
      )?.schema;

      expect(schema?.["lineHeight"]).toMatchObject({
        kind: "number",
        constraints: { min: 1, max: 2, step: 0.05 },
      });
      expect(schema?.["fontWeight"]).toMatchObject({
        kind: "select",
        constraints: {
          options: [
            { label: "Light", value: 300 },
            { label: "Regular", value: 400 },
            { label: "Medium", value: 500 },
            { label: "Semibold", value: 600 },
            { label: "Bold", value: 700 },
            { label: "Extra bold", value: 800 },
          ],
        },
      });
      expect(schema?.["letterSpacing"]).toMatchObject({
        kind: "number",
        defaultValue: 0,
        constraints: { min: -2, max: 10, step: 0.5, unit: "px" },
      });
      for (const name of ["lineHeight", "fontWeight", "letterSpacing"]) {
        expect(schema?.[name]).not.toHaveProperty("mobile");
      }
    });
  });

  it("starts a heading at 1.2 and bold", () => {
    const [style] = typographyStyles("heading", {});

    expect(style?.["line-height"]).toBe("120%");
    expect(style?.["font-weight"]).toBe("700");
  });

  it("starts text at 1.5 and regular, which is 24px at 16px as before", () => {
    const html = markup(
      alone({ id: "copy", type: "text", props: { content: "Words" } }),
    );
    const [style] = paragraphStyles(html);

    expect(stylesOf(html, "td").map((cell) => cell["font-size"])).toContain(
      "16px",
    );
    expect(style?.["font-size"]).toBe("1em");
    expect(style?.["line-height"]).toBe("150%");
    expect(style?.["font-weight"]).toBe("400");
  });

  it("falls back to the default for a stored value that is not a number", () => {
    // Unchecked, because a string in a number prop is the wrong shape and an
    // error stops the render. A preview still renders it.
    const [style] = typographyStyles(
      "text",
      { lineHeight: "tall", fontWeight: "bold", letterSpacing: "wide" },
      unchecked,
    );

    expect(style?.["line-height"]).toBe("150%");
    expect(style?.["font-weight"]).toBe("400");
    expect(style).not.toHaveProperty("letter-spacing");
  });
});

const SIDES = ["Top", "Right", "Bottom", "Left"] as const;

// ADR-0024 and #67: every Block but the root pads on four sides, on a cell.
// The spacer is spacing, so it pads nothing either (#76). An icon is padded
// by its row (#78), and a nav link by its nav (#79).
const UNPADDED = [REACT_EMAIL_ROOT_TYPE, "spacer", "icon", "nav-link"];

describe("padding on four sides", () => {
  it("gives every Block but the root, the spacer, the icon and the nav link four Overridable sides, 0 to 96px", () => {
    for (const definition of definitions) {
      const sides = SIDES.map((side) => definition.schema[`padding${side}`]);
      if (UNPADDED.includes(definition.type)) {
        expect(sides).toEqual([undefined, undefined, undefined, undefined]);
        continue;
      }
      expect(sides.map((entry) => entry?.label)).toEqual([
        "Top padding",
        "Right padding",
        "Bottom padding",
        "Left padding",
      ]);
      for (const [index, entry] of sides.entries()) {
        expect(entry?.kind).toBe("number");
        expect(entry?.constraints).toMatchObject({ min: 0, max: 96 });
        expect(entry?.mobile?.(8, {})).toEqual({
          [`padding-${SIDES[index]?.toLowerCase() ?? ""}`]: "8px",
        });
      }
    }
  });

  it("declares the four sides as one Box, so an Inspector edits them as one", () => {
    for (const definition of definitions) {
      if (UNPADDED.includes(definition.type)) continue;
      expect(
        SIDES.map((side) => {
          const entry = definition.schema[`padding${side}`];
          return [entry?.box, entry?.side];
        }),
      ).toEqual([
        ["padding", "top"],
        ["padding", "right"],
        ["padding", "bottom"],
        ["padding", "left"],
      ]);
    }
  });

  it("starts at zero, except the divider's 16 above and below", () => {
    const defaults = Object.fromEntries(
      definitions
        .filter((definition) => !UNPADDED.includes(definition.type))
        .map((definition) => [
          definition.type,
          SIDES.map(
            (side) => definition.schema[`padding${side}`]?.defaultValue,
          ),
        ]),
    );

    expect(defaults).toEqual({
      section: [0, 0, 0, 0],
      columns: [0, 0, 0, 0],
      column: [0, 0, 0, 0],
      heading: [0, 0, 0, 0],
      text: [0, 0, 0, 0],
      image: [0, 0, 0, 0],
      button: [0, 0, 0, 0],
      divider: [16, 0, 16, 0],
      html: [0, 0, 0, 0],
      "icon-row": [0, 0, 0, 0],
      nav: [0, 0, 0, 0],
    });
  });

  it.each(PADDED)(
    "puts the %s's padding and its Mobile Override class on one cell",
    (type) => {
      const html = markup(
        placed(
          type,
          { paddingTop: 24, paddingLeft: 8, showOn: "desktop" },
          { paddingTop: 4 },
        ),
      );
      const cell = overriddenCell(html);

      expect(styleOf(cell)).toMatchObject({
        "padding-top": "24px",
        "padding-left": "8px",
      });
      expect(tagsWearingOverride(html)).toEqual(["td"]);
      // The column is a cell of its row, so its cell is its outermost.
      const outer = type === "column" ? cell : outermost(html);
      expect(outer?.classList.contains("lekh-hidden")).toBe(true);
      // Once on the Block, once in the stylesheet.
      expect(parseMarkup(html).all(".lekh-hidden")).toHaveLength(1);
      expect(stylesheetOf(html).split("lekh-hidden")).toHaveLength(2);
    },
  );

  it("replaces one side on a phone and leaves the others alone", () => {
    const html = markup(
      placed(
        "section",
        { paddingTop: 24, paddingRight: 8, paddingBottom: 24, paddingLeft: 8 },
        { paddingTop: 4 },
      ),
    );

    expect(html).toContain(".lekh-m-subject{padding-top:4px!important}");
    // Inline on the same cell the class is on, so the rule replaces it
    // rather than adding to a padding further out.
    expect(styleOf(overriddenCell(html))).toMatchObject({
      "padding-top": "24px",
      "padding-right": "8px",
      "padding-bottom": "24px",
      "padding-left": "8px",
    });
  });

  it("sizes the heading by its cell, so a font-size override reaches it", () => {
    const html = markup(
      placed(
        "heading",
        { content: "Hi", fontSize: 40, align: "center" },
        { fontSize: 24 },
      ),
    );
    const heading = styleOf(parseMarkup(html).one("h1"));
    const cell = overriddenCell(html);

    expect(html).toContain(".lekh-m-subject{font-size:24px!important}");
    expect(styleOf(cell)).toMatchObject({
      "font-size": "40px",
      "text-align": "center",
    });
    expect(cell.getAttribute("align")).toBe("center");
    expect(heading).toMatchObject({ "font-size": "1em", margin: "0" });
    expect(heading).not.toHaveProperty("text-align");
  });

  it("renders an unset divider 16px above and below, as it always has", () => {
    const html = markup(placed("divider", {}, { paddingTop: 16 }));

    expect(styleOf(overriddenCell(html))).toMatchObject({
      "padding-top": "16px",
      "padding-bottom": "16px",
    });
    expect(styleOf(parseMarkup(html).one("hr"))["margin"]).toBe("0");
    expect(html).not.toContain("margin:16px 0");
  });
});

const editorFor = (block: Block) =>
  createEditor({ definitions, document: alone(block) });

// ADR-0024: the containers' old padding props, split into four sides.
describe("the padding migration", () => {
  it("splits a section's paddingY and paddingX, overrides too", () => {
    const editor = editorFor({
      id: "subject",
      type: "section",
      props: { paddingY: 24, paddingX: 8 },
      mobile: { paddingX: 4 },
      children: [],
    });
    const block = editor.getBlock("subject");

    expect(block?.props).toEqual({
      paddingTop: 24,
      paddingBottom: 24,
      paddingLeft: 8,
      paddingRight: 8,
    });
    expect(block?.mobile).toEqual({ paddingLeft: 4, paddingRight: 4 });
    expect(block?.version).toBe(2);
  });

  it("splits a row's the same way", () => {
    const editor = editorFor({
      id: "subject",
      type: "columns",
      props: { paddingY: 10 },
      mobile: { paddingY: 2 },
      children: [
        { id: "a", type: "column", props: {}, children: [] },
        { id: "b", type: "column", props: {}, children: [] },
      ],
    });
    const block = editor.getBlock("subject");

    expect(block?.props).toEqual({ paddingTop: 10, paddingBottom: 10 });
    expect(block?.mobile).toEqual({ paddingTop: 2, paddingBottom: 2 });
  });

  it("makes a column's one padding into four", () => {
    const editor = editorFor({
      id: "row",
      type: "columns",
      props: {},
      children: [
        {
          id: "subject",
          type: "column",
          props: { padding: 12, width: 50 },
          mobile: { padding: 6 },
          children: [],
        },
        { id: "b", type: "column", props: {}, children: [] },
      ],
    });
    const block = editor.getBlock("subject");

    expect(block?.props).toEqual({
      width: 50,
      paddingTop: 12,
      paddingRight: 12,
      paddingBottom: 12,
      paddingLeft: 12,
    });
    expect(block?.mobile).toEqual({
      paddingTop: 6,
      paddingRight: 6,
      paddingBottom: 6,
      paddingLeft: 6,
    });
  });

  it("leaves an unset padding unset, and a Block with no overrides without any", () => {
    const editor = editorFor({
      id: "subject",
      type: "section",
      props: { backgroundColor: "#ffffff" },
      children: [],
    });
    const block = editor.getBlock("subject");

    expect(block?.props).toEqual({ backgroundColor: "#ffffff" });
    expect(block).not.toHaveProperty("mobile");
  });

  it("does nothing the second time", () => {
    for (const type of ["section", "columns", "column"]) {
      const migration = definitions.find(
        (definition) => definition.type === type,
      )?.migrations?.[1];
      const once = migration?.({
        props: { paddingY: 24, paddingX: 8, padding: 12 },
        mobile: { paddingX: 4, padding: 2 },
      });

      expect(once && migration?.({ mobile: undefined, ...once })).toEqual(once);
    }
  });
});

describe("the shipped Schema kinds", () => {
  it("are all named on SchemaKind", () => {
    const known: readonly string[] = Object.values(SchemaKind);
    const shipped = [
      ...definitions,
      ...createCompliancePreset({ unsubscribeUrl: "{{unsubscribe}}" }),
    ];
    const unknown = shipped.flatMap((definition) =>
      Object.entries(definition.schema)
        .filter(([, entry]) => !known.includes(entry.kind))
        .map(([prop, entry]) => `${definition.type}.${prop}: ${entry.kind}`),
    );

    expect(unknown).toEqual([]);
  });
});

/** The names of a Preset Block's `advanced` entries, in Schema order. */
const advancedOf = (type: string) =>
  Object.entries(
    definitions.find((definition) => definition.type === type)?.schema ?? {},
  )
    .filter(([, entry]) => entry.advanced === true)
    .map(([name]) => name);

// #158: the settings an Author rarely needs are folded away.
describe("the advanced entries", () => {
  const BORDER = ["borderWidth", "borderStyle", "borderColor", "borderRadius"];

  it.each([
    ["button", ["innerPaddingY", "innerPaddingX", ...BORDER, "showOn"]],
    ["section", [...BORDER, "showOn"]],
    ["columns", [...BORDER, "showOn"]],
    ["column", [...BORDER, "showOn"]],
    ["text", ["showOn"]],
    ["heading", ["showOn"]],
    ["image", ["showOn"]],
    ["divider", ["showOn"]],
    ["spacer", ["showOn"]],
    ["nav", ["showOn"]],
    ["icon-row", ["showOn"]],
    ["html", ["showOn"]],
    [REACT_EMAIL_ROOT_TYPE, []],
  ])(
    "marks only the %s Block's inner spacing, border and Show on",
    (type, names) => {
      expect(advancedOf(type)).toEqual(names);
    },
  );

  it("leaves the common settings open", () => {
    const editor = createEditor({
      definitions,
      document: alone({ id: "subject", type: "button", props: {} }),
    });
    editor.select("subject");
    const open = editor
      .getControls()
      .filter((control) => control.advanced !== true)
      .map((control) => control.name);

    expect(open).toEqual(
      expect.arrayContaining(["label", "href", "paddingTop", "fontSize"]),
    );
  });
});
