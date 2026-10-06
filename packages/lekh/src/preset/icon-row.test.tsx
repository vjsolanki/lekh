import { describe, expect, it } from "vitest";

import {
  SchemaKind,
  createEditor,
  NONE,
  type Block,
  type Editor,
  type EmailDocument,
} from "../index";
import { createReactEmailPreset, REACT_EMAIL_ROOT_TYPE } from "../blocks";
import { outlookMarkup, parseMarkup, styleOf } from "../testing/markup";
import {
  definitions,
  markup,
  alone,
  tagsWearingOverride,
  outermost,
  overriddenCell,
  anchors,
  editorWithIcons,
  tagOf,
  definitionOf,
  unchecked,
} from "../testing/preset";

/** A new icon row under the root, by id. */
function placeRow(editor: Editor): string {
  return editor.insertBlock("icon-row", editor.getDocument().root.id) ?? "";
}

function iconsOf(editor: Editor, rowId: string): readonly Block[] {
  return editor.getBlock(rowId)?.children ?? [];
}

/** The row's one cell: the one with the zeroed font. */
const rowCell = (html: string): Element => {
  const [cell] = parseMarkup(html)
    .all("td")
    .filter((td) => {
      const style = styleOf(td);
      return style["font-size"] === "0" && style["line-height"] === "0";
    });
  if (cell === undefined) throw new Error("No cell zeroes its font.");
  return cell;
};

/** Every image in the markup, in order. */
const images = (html: string): readonly Element[] =>
  parseMarkup(html).all("img");

/** One icon row under the root, its icons holding the props given. */
const row = (
  icons: readonly Record<string, unknown>[],
  props: Record<string, unknown> = {},
  rootProps: Record<string, unknown> = {},
  mobile?: Record<string, unknown>,
): EmailDocument =>
  alone(
    {
      id: "subject",
      type: "icon-row",
      props,
      ...(mobile ? { mobile } : {}),
      children: icons.map((iconProps, at) => ({
        id: `icon-${String(at)}`,
        type: "icon",
        props: iconProps,
      })),
    },
    { backgroundColor: "none", ...rootProps },
  );

// #78, ADR-0030: small linked images side by side, that stay side by side on a
// phone and wrap only when out of room.
describe("the icon row", () => {
  const ON_X = {
    src: "https://cdn.example.com/x.png",
    width: 64,
    height: 64,
    alt: "Acme on X",
  };
  const ON_INSTAGRAM = {
    src: "https://cdn.example.com/instagram.png",
    width: 64,
    height: 48,
    alt: "Acme on Instagram",
  };
  const ON_YOUTUBE = {
    src: "https://cdn.example.com/youtube.png",
    width: 64,
    height: 64,
    alt: "Acme on YouTube",
  };

  const ICONS = [
    { label: "X", asset: ON_X, href: "https://x.com/acme" },
    { label: "Instagram", asset: ON_INSTAGRAM },
    { label: "YouTube", asset: ON_YOUTUBE, href: "https://youtube.com/acme" },
    {
      label: "LinkedIn",
      asset: { ...ON_X, src: "https://cdn.example.com/in.png" },
    },
  ];

  const twoIcons = [
    { asset: ON_X, href: "https://x.com/acme" },
    { asset: ON_INSTAGRAM, href: "https://instagram.com/acme" },
  ];

  describe("its Definitions", () => {
    it("is called Icon row, holds one to twelve icons, and arrives with three", () => {
      const definition = definitionOf("icon-row");

      expect(definition?.label).toBe("Icon row");
      expect(definition?.accepts).toEqual(["icon"]);
      expect(definition?.minChildren).toBe(1);
      expect(definition?.maxChildren).toBe(12);
      expect(definition?.seed?.()).toHaveLength(3);
    });

    it("holds a size, a gap, an alignment, a color, padding and showOn", () => {
      const schema = definitionOf("icon-row")?.schema ?? {};

      expect(Object.keys(schema)).toEqual([
        "iconSize",
        "gap",
        "align",
        "backgroundColor",
        "paddingTop",
        "paddingRight",
        "paddingBottom",
        "paddingLeft",
        "showOn",
      ]);
      expect(schema["iconSize"]).toMatchObject({
        kind: "number",
        defaultValue: 32,
        constraints: { min: 16, max: 64, unit: "px" },
      });
      expect(schema["gap"]).toMatchObject({
        kind: "number",
        defaultValue: 12,
        constraints: { min: 0, max: 32, unit: "px" },
      });
      expect(schema["align"]).toMatchObject({
        kind: "align",
        defaultValue: "center",
      });
      expect(schema["align"]?.mobile?.("end", {})).toEqual({
        "text-align": "right",
      });
      expect(schema["backgroundColor"]).toMatchObject({
        kind: SchemaKind.surface,
        defaultValue: NONE,
      });
      expect(schema["showOn"]?.constraints?.["options"]).toHaveLength(3);
    });

    it("makes the icon structural, with an optional Asset and a link", () => {
      const definition = definitionOf("icon");
      const schema = definition?.schema ?? {};

      expect(definition?.label).toBe("Icon");
      expect(definition?.structural).toBe(true);
      expect(definition?.accepts).toBeUndefined();
      expect(Object.keys(schema)).toEqual(["asset", "href"]);
      expect(schema["asset"]).toMatchObject({
        kind: SchemaKind.asset,
        label: "Icon",
        defaultValue: undefined,
        constraints: { options: [] },
      });
      expect(schema["asset"]?.primary).toBeUndefined();
      expect(schema["href"]).toMatchObject({ kind: "url", defaultValue: "" });
    });

    it("can go under the root, in a section and in a column", () => {
      for (const type of [REACT_EMAIL_ROOT_TYPE, "section", "column"]) {
        expect(definitionOf(type)?.accepts).toContain("icon-row");
      }
    });
  });

  describe("its markup", () => {
    it("puts every icon in one centred cell with no gaps between lines", () => {
      const cell = rowCell(markup(row(twoIcons)));

      expect(cell.getAttribute("align")).toBe("center");
      expect(cell.getAttribute("dir")).toBe("ltr");
      expect(cell.getAttribute("style")).toBe(
        "text-align:center;font-size:0;line-height:0",
      );
    });

    it("links each icon round an image at the icon size", () => {
      const html = markup(row(twoIcons));

      expect(anchors(html).map((element) => tagOf(element))).toEqual([
        {
          tag: "a",
          href: "https://x.com/acme",
          style: "display:inline-block;padding-right:12px",
        },
        {
          tag: "a",
          href: "https://instagram.com/acme",
          style: "display:inline-block;padding-right:0",
        },
      ]);
      expect(images(html).map((element) => tagOf(element))).toEqual([
        {
          tag: "img",
          src: "https://cdn.example.com/x.png",
          width: "32",
          height: "32",
          alt: "Acme on X",
          style: "display:block;width:32px;height:32px;border:0",
        },
        {
          tag: "img",
          src: "https://cdn.example.com/instagram.png",
          width: "32",
          height: "24",
          alt: "Acme on Instagram",
          style: "display:block;width:32px;height:24px;border:0",
        },
      ]);
    });

    it("sizes and spaces them by the row", () => {
      const html = markup(row(twoIcons, { iconSize: 48, gap: 20 }));

      const [first] = anchors(html);
      expect(first && styleOf(first)["padding-right"]).toBe("20px");
      expect(images(html)[1]?.getAttribute("width")).toBe("48");
      expect(images(html)[1]?.getAttribute("height")).toBe("36");
    });

    it("puts the gap on the left in a right-to-left email", () => {
      const html = markup(row(twoIcons, {}, { direction: "rtl" }));

      expect(rowCell(html).getAttribute("dir")).toBe("rtl");
      expect(
        anchors(html).map((anchor) => styleOf(anchor)["padding-left"]),
      ).toEqual(["12px", "0"]);
      expect(html).not.toContain("padding-right");
    });

    it.each([
      ["start", "ltr", "left"],
      ["end", "ltr", "right"],
      ["start", "rtl", "right"],
      ["end", "rtl", "left"],
      ["center", "rtl", "center"],
    ])("aligns %s in %s to the %s", (align, direction, side) => {
      const html = markup(row(twoIcons, { align }, { direction }));

      expect(rowCell(html).getAttribute("align")).toBe(side);
      expect(styleOf(rowCell(html))["text-align"]).toBe(side);
      expect(html).toContain(
        `<table role="presentation" align="${side}" dir="${direction}"`,
      );
    });

    it("draws an icon with no link inside a span", () => {
      const html = markup(row([{ asset: ON_X }]));

      expect(anchors(html).map((element) => tagOf(element))).toEqual([
        { tag: "span", style: "display:inline-block;padding-right:0" },
      ]);
      expect(parseMarkup(html).all("a")).toEqual([]);
    });

    it("keeps the icons in one row in classic Outlook, a cell each", () => {
      const html = markup(row(twoIcons));

      expect(html).toContain(
        '<!--[if mso]><table role="presentation" align="center" dir="ltr" ' +
          'border="0" cellpadding="0" cellspacing="0"><tr>' +
          '<td style="padding-right:12px"><![endif]--><a href="https://x.com/acme"',
      );
      expect(html).toContain(
        '</a><!--[if mso]></td><td style="padding-right:0"><![endif]-->' +
          '<a href="https://instagram.com/acme"',
      );
      expect(html).toContain(
        "</a><!--[if mso]></td></tr></table><![endif]--></td>",
      );
    });

    it("leaves an icon with no image out of the email, Outlook cell too", () => {
      const html = unchecked(row([twoIcons[0] ?? {}, {}, twoIcons[1] ?? {}]));

      expect(images(html)).toHaveLength(2);
      expect(
        anchors(html).map((anchor) => styleOf(anchor)["padding-right"]),
      ).toEqual(["12px", "0"]);
      expect(
        outlookMarkup(html)
          .all("td")
          .map((td) => "padding-right" in styleOf(td)),
      ).toEqual([true, true]);
    });

    it("pads and paints its cell", () => {
      const cell = rowCell(
        markup(
          row(twoIcons, {
            paddingTop: 8,
            paddingLeft: 4,
            backgroundColor: "#101010",
          }),
        ),
      );

      expect(styleOf(cell)).toMatchObject({
        "padding-top": "8px",
        "padding-left": "4px",
        "background-color": "#101010",
      });
    });

    it("moves on a phone through a class on its cell", () => {
      const html = markup(row(twoIcons, {}, {}, { align: "end" }));

      expect(html).toContain(".lekh-m-subject{text-align:right!important}");
      expect(tagsWearingOverride(html)).toEqual(["td"]);
      expect(styleOf(overriddenCell(html))["font-size"]).toBe("0");
    });

    it("hides its whole table on a phone when desktop only", () => {
      const html = markup(row(twoIcons, { showOn: "desktop" }));

      expect(outermost(html)?.localName).toBe("table");
      expect(outermost(html)?.getAttribute("class")).toBe("lekh-hidden");
    });
  });

  describe("in the editor", () => {
    it("lists the Consumer's icons on the icon's Asset", () => {
      const schema = definitionOf(
        "icon",
        createReactEmailPreset({ icons: ICONS }),
      )?.schema;

      expect(schema?.["asset"]?.constraints).toEqual({
        options: ICONS.map(({ label, asset }) => ({ label, asset })),
      });
    });

    it("seeds three empty icons with no icons listed", () => {
      const editor = editorWithIcons();
      const rowId = placeRow(editor);

      expect(iconsOf(editor, rowId).map((icon) => icon.props)).toEqual([
        {},
        {},
        {},
      ]);
    });

    it("seeds the first three listed icons, with their links", () => {
      const editor = editorWithIcons(ICONS);
      const rowId = placeRow(editor);

      expect(iconsOf(editor, rowId).map((icon) => icon.props)).toEqual([
        { asset: ON_X, href: "https://x.com/acme" },
        { asset: ON_INSTAGRAM },
        { asset: ON_YOUTUBE, href: "https://youtube.com/acme" },
      ]);
    });

    it("leaves the rest empty with fewer than three listed", () => {
      const editor = editorWithIcons(ICONS.slice(0, 2));
      const rowId = placeRow(editor);

      expect(iconsOf(editor, rowId).map((icon) => icon.props)).toEqual([
        { asset: ON_X, href: "https://x.com/acme" },
        { asset: ON_INSTAGRAM },
        {},
      ]);
    });

    it("goes down to one icon and no further", () => {
      const editor = editorWithIcons();
      const rowId = placeRow(editor);
      const [first, second, third] = iconsOf(editor, rowId);

      expect(editor.removeBlock(first?.id ?? "")).toBe(true);
      expect(editor.removeBlock(second?.id ?? "")).toBe(true);
      expect(editor.removeBlock(third?.id ?? "")).toBe(false);
    });

    it("goes up to twelve icons and no further", () => {
      const editor = editorWithIcons();
      const rowId = placeRow(editor);
      for (let at = 3; at < 12; at += 1) {
        expect(editor.insertBlock("icon", rowId)).toBeDefined();
      }

      expect(editor.insertBlock("icon", rowId)).toBeUndefined();
      expect(iconsOf(editor, rowId)).toHaveLength(12);
    });

    it("places a row without asking for an image", () => {
      const editor = editorWithIcons();

      expect(editor.place({ reason: "insert", type: "icon-row" }).status).toBe(
        "inserted",
      );
      expect(editor.getImageRequests()).toEqual([]);
    });

    it("asks for an image for one icon's Asset by name", async () => {
      let answer: ((asset: typeof ON_X) => void) | undefined;
      const editor = createEditor({
        definitions,
        rootType: REACT_EMAIL_ROOT_TYPE,
        resolveImage: () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      });
      const rowId = editor.insertBlock(
        "icon-row",
        editor.getDocument().root.id,
      );
      const iconId = editor.getBlock(rowId ?? "")?.children?.[1]?.id ?? "";

      expect(editor.replaceImage(iconId)).toBe(false);
      expect(editor.replaceImage(iconId, "replace", "asset")).toBe(true);
      answer?.(ON_YOUTUBE);
      await Promise.resolve();
      await Promise.resolve();

      expect(editor.getBlock(iconId)?.props["asset"]).toEqual(ON_YOUTUBE);
    });

    it("sets a listed icon with no request, and refuses an unlisted one", () => {
      const editor = editorWithIcons(ICONS);
      const rowId = placeRow(editor);
      const iconId = iconsOf(editor, rowId)[0]?.id ?? "";

      expect(editor.setProp(iconId, "asset", ON_YOUTUBE)).toBe(true);
      expect(editor.getImageRequests()).toEqual([]);
      expect(
        editor.setProp(iconId, "asset", {
          src: "https://elsewhere.example.com/blob.png",
          width: 64,
          height: 64,
        }),
      ).toBe(false);
      expect(editor.getBlock(iconId)?.props["asset"]).toEqual(ON_YOUTUBE);
    });

    it("calls an icon with no image an error, and one with no alt a warning", () => {
      const editor = createEditor({
        definitions,
        rootType: REACT_EMAIL_ROOT_TYPE,
        document: row([
          {},
          { asset: { ...ON_X, alt: undefined } },
          { asset: ON_X },
        ]),
      });

      expect(
        editor.getDiagnostics().map(({ code, severity, blockId, prop }) => ({
          code,
          severity,
          blockId,
          prop,
        })),
      ).toEqual([
        {
          code: "icon-image-missing",
          severity: "error",
          blockId: "icon-0",
          prop: "asset",
        },
        {
          code: "icon-alt-text-missing",
          severity: "warning",
          blockId: "icon-1",
          prop: "asset",
        },
      ]);
    });
  });

  describe("the icons option", () => {
    it.each([
      ["no src", { ...ON_X, src: "" }],
      ["a zero width", { ...ON_X, width: 0 }],
      ["a negative height", { ...ON_X, height: -1 }],
    ])("throws on an icon with %s", (_, asset) => {
      expect(() =>
        createReactEmailPreset({ icons: [{ label: "Broken", asset }] }),
      ).toThrow(/icon "Broken"/u);
    });
  });
});
