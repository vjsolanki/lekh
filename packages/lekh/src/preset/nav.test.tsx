import { describe, expect, it } from "vitest";

import {
  createEditor,
  NONE,
  SchemaKind,
  type Editor,
  type EmailDocument,
} from "../index";
import { REACT_EMAIL_ROOT_TYPE } from "../blocks";
import {
  outlookMarkup,
  parseMarkup,
  styleOf,
  stylesheetOf,
} from "../testing/markup";
import {
  definitions,
  DEFAULT_FONT_STACK,
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

/** A new nav under the root, by id. */
function placeNav(editor: Editor): string {
  return editor.insertBlock("nav", editor.getDocument().root.id) ?? "";
}

/** The nav's one cell: the one with the px line height. */
const navCell = (html: string): Element => {
  const [cell] = parseMarkup(html)
    .all("td[dir]")
    .filter((td) => styleOf(td)["line-height"]?.endsWith("px") === true);
  if (cell === undefined) throw new Error("No cell sets a px line height.");
  return cell;
};

/** Each link and separator, as the email or the Canvas writes it. */
const navItems = (html: string): readonly Element[] =>
  anchors(html).filter((item) => item.children.length === 0);

/** A link or separator as its tag, its attributes and its text. */
const itemOf = (item: Element) => ({ ...tagOf(item), text: item.textContent });

/** One nav under the root, its links holding the props given. */
const nav = (
  links: readonly Record<string, unknown>[],
  props: Record<string, unknown> = {},
  rootProps: Record<string, unknown> = {},
  mobile?: Record<string, unknown>,
): EmailDocument =>
  alone(
    {
      id: "subject",
      type: "nav",
      props,
      ...(mobile ? { mobile } : {}),
      children: links.map((linkProps, at) => ({
        id: `link-${String(at)}`,
        type: "nav-link",
        props: linkProps,
      })),
    },
    { backgroundColor: "none", ...rootProps },
  );

// #79: a row of text links that wraps on a phone, or stacks if asked.
describe("the nav", () => {
  const shopAbout = [
    { label: "Shop", href: "https://example.com/shop" },
    { label: "About", href: "https://example.com/about" },
  ];

  const LINK = "#0b57d0";

  describe("its Definitions", () => {
    it("is called Navigation, holds one to eight links, and arrives with three", () => {
      const definition = definitionOf("nav");

      expect(definition?.label).toBe("Navigation");
      expect(definition?.accepts).toEqual(["nav-link"]);
      expect(definition?.minChildren).toBe(1);
      expect(definition?.maxChildren).toBe(8);
      expect(definition?.seed?.()).toEqual([
        { label: "Link 1" },
        { label: "Link 2" },
        { label: "Link 3" },
      ]);
    });

    it("holds the links' look, an alignment, stacking, a color, padding and showOn", () => {
      const schema = definitionOf("nav")?.schema ?? {};

      expect(Object.keys(schema)).toEqual([
        "gap",
        "separator",
        "color",
        "fontSize",
        "fontWeight",
        "letterSpacing",
        "underline",
        "align",
        "stackOnMobile",
        "backgroundColor",
        "paddingTop",
        "paddingRight",
        "paddingBottom",
        "paddingLeft",
        "showOn",
      ]);
      expect(schema["gap"]).toMatchObject({
        kind: "number",
        defaultValue: 16,
        constraints: { min: 0, max: 48, unit: "px" },
      });
      expect(schema["separator"]).toMatchObject({
        kind: "text",
        defaultValue: "",
        constraints: { maxLength: 3 },
      });
      expect(schema["color"]).toMatchObject({
        kind: "color",
        follows: "linkColor",
        defaultValue: LINK,
      });
      expect(schema["fontSize"]).toMatchObject({
        kind: "number",
        defaultValue: 14,
        constraints: { min: 10, max: 32, unit: "px" },
      });
      expect(schema["fontWeight"]).toMatchObject({
        kind: "select",
        defaultValue: 400,
      });
      expect(schema["letterSpacing"]).toMatchObject({ defaultValue: 0 });
      expect(schema["underline"]).toMatchObject({
        kind: "boolean",
        defaultValue: false,
      });
      expect(schema["align"]).toMatchObject({
        kind: "align",
        defaultValue: "center",
      });
      expect(schema["align"]?.mobile?.("start", {})).toEqual({
        "text-align": "left",
      });
      expect(schema["stackOnMobile"]).toMatchObject({
        kind: "boolean",
        defaultValue: false,
      });
      expect(schema["stackOnMobile"]).not.toHaveProperty("mobile");
      expect(schema["backgroundColor"]).toMatchObject({
        kind: SchemaKind.surface,
        defaultValue: NONE,
      });
      expect(schema["showOn"]?.constraints?.["options"]).toHaveLength(3);
    });

    it("makes the link structural, with a label and an address", () => {
      const definition = definitionOf("nav-link");
      const schema = definition?.schema ?? {};

      expect(definition?.label).toBe("Link");
      expect(definition?.structural).toBe(true);
      expect(definition?.accepts).toBeUndefined();
      expect(Object.keys(schema)).toEqual(["label", "href"]);
      expect(schema["label"]).toMatchObject({ kind: "text" });
      expect(schema["href"]).toMatchObject({ kind: "url", defaultValue: "" });
    });

    it("can go under the root, in a section and in a column", () => {
      for (const type of [REACT_EMAIL_ROOT_TYPE, "section", "column"]) {
        expect(definitionOf(type)?.accepts).toContain("nav");
      }
    });
  });

  describe("its markup", () => {
    it("puts every link in one centred cell with the email's font and a px line height", () => {
      const cell = navCell(markup(nav(shopAbout)));

      expect(cell.getAttribute("align")).toBe("center");
      expect(cell.getAttribute("dir")).toBe("ltr");
      expect(cell.getAttribute("style")).toBe(
        `text-align:center;font-family:${DEFAULT_FONT_STACK};` +
          "font-size:14px;line-height:20px",
      );
    });

    it("sizes the line height in px from the font size", () => {
      expect(
        styleOf(navCell(markup(nav(shopAbout, { fontSize: 15 })))),
      ).toMatchObject({ "font-size": "15px", "line-height": "21px" });
    });

    it("links each label, spaced on the end side, the last with no gap", () => {
      expect(
        navItems(markup(nav(shopAbout))).map((item) => itemOf(item)),
      ).toEqual([
        {
          tag: "a",
          href: "https://example.com/shop",
          style: `display:inline-block;color:${LINK};font-weight:400;text-decoration:none;padding-right:16px`,
          text: "Shop",
        },
        {
          tag: "a",
          href: "https://example.com/about",
          style: `display:inline-block;color:${LINK};font-weight:400;text-decoration:none;padding-right:0`,
          text: "About",
        },
      ]);
    });

    it("writes the weight, letter spacing, underline and gap", () => {
      const [first] = navItems(
        markup(
          nav(shopAbout, {
            fontWeight: 700,
            letterSpacing: 1,
            underline: true,
            gap: 24,
          }),
        ),
      );

      expect(first && styleOf(first)).toMatchObject({
        "font-weight": "700",
        "letter-spacing": "1px",
        "text-decoration": "underline",
        "padding-right": "24px",
      });
    });

    it("puts the gap on the left in a right-to-left email", () => {
      const html = markup(
        nav(shopAbout, { separator: "|" }, { direction: "rtl" }),
      );

      expect(navCell(html).getAttribute("dir")).toBe("rtl");
      expect(
        navItems(html).map((item) => styleOf(item)["padding-left"]),
      ).toEqual(["16px", "16px", "0"]);
      expect(html).not.toContain("padding-right");
    });

    it.each([
      ["start", "ltr", "left"],
      ["end", "ltr", "right"],
      ["start", "rtl", "right"],
      ["end", "rtl", "left"],
      ["center", "rtl", "center"],
    ])("aligns %s in %s to the %s", (align, direction, side) => {
      const html = markup(nav(shopAbout, { align }, { direction }));

      expect(navCell(html).getAttribute("align")).toBe(side);
      expect(styleOf(navCell(html))["text-align"]).toBe(side);
      expect(html).toContain(
        `<table role="presentation" align="${side}" dir="${direction}"`,
      );
    });

    it("puts a separator between links, never after the last", () => {
      const html = markup(
        nav(
          [...shopAbout, { label: "Blog", href: "https://example.com/blog" }],
          {
            separator: "|",
          },
        ),
      );

      const separator = {
        tag: "span",
        style: `display:inline-block;color:${LINK};padding-right:16px`,
        text: "|",
      };
      expect(navItems(html).map((item) => itemOf(item))).toEqual([
        expect.objectContaining({ tag: "a", text: "Shop" }),
        separator,
        expect.objectContaining({ tag: "a", text: "About" }),
        separator,
        expect.objectContaining({ tag: "a", text: "Blog" }),
      ]);
    });

    it("writes no separator when it is empty", () => {
      const html = markup(nav(shopAbout));

      expect(navItems(html)).toHaveLength(2);
      expect(parseMarkup(html).all("span")).toEqual([]);
    });

    it("draws a link with no address as a span, never an empty href", () => {
      const html = markup(nav([{ label: "Shop" }]));

      expect(navItems(html).map((item) => itemOf(item))).toEqual([
        {
          tag: "span",
          style: `display:inline-block;color:${LINK};font-weight:400;text-decoration:none;padding-right:0`,
          text: "Shop",
        },
      ]);
      expect(parseMarkup(html).all('[href=""]')).toEqual([]);
    });

    it("leaves a link with no label out, with its separator and Outlook cell", () => {
      const html = unchecked(
        nav(
          [
            shopAbout[0] ?? {},
            { label: " ", href: "https://x" },
            shopAbout[1] ?? {},
          ],
          {
            separator: "|",
          },
        ),
      );

      expect(navItems(html).map((item) => itemOf(item))).toEqual([
        expect.objectContaining({ tag: "a", text: "Shop" }),
        expect.objectContaining({ tag: "span", text: "|" }),
        expect.objectContaining({ tag: "a", text: "About" }),
      ]);
      expect(html).not.toContain("https://x");
      expect(
        outlookMarkup(html)
          .all("td")
          .filter((td) => "padding-right" in styleOf(td)),
      ).toHaveLength(3);
    });

    it("gives the last link that shows no gap, with blank links after it", () => {
      const html = unchecked(
        nav([...shopAbout, { label: "" }], { stackOnMobile: true }),
      );

      expect(
        navItems(html).map((item) => styleOf(item)["padding-right"]),
      ).toEqual(["16px", "0"]);
      expect(navItems(html)[1]?.getAttribute("class")).toBe("lekh-nav-stack-0");
      expect(html).toContain(
        '<!--[if mso]></td><td style="padding-right:0"><![endif]--><a href="https://example.com/about"',
      );
    });

    it("draws a link whose address is only spaces as a span", () => {
      const html = unchecked(nav([{ label: "Shop", href: "  " }]));

      expect(navItems(html).map((item) => item.localName)).toEqual(["span"]);
    });

    it("puts no separator after the last link that shows", () => {
      const html = unchecked(
        nav([...shopAbout, { label: "" }], { separator: "|" }),
      );

      expect(navItems(html).map((item) => itemOf(item))).toEqual([
        expect.objectContaining({ tag: "a", text: "Shop" }),
        expect.objectContaining({ tag: "span", text: "|" }),
        expect.objectContaining({ tag: "a", text: "About" }),
      ]);
    });

    it("writes links and separators in the email's link color", () => {
      const html = markup(
        nav(shopAbout, { separator: "/" }, { linkColor: "#aa0000" }),
      );

      expect(
        navItems(html).every((item) => styleOf(item)["color"] === "#aa0000"),
      ).toBe(true);
    });

    it("writes a color of its own over the email's", () => {
      const html = markup(
        nav(
          shopAbout,
          { separator: "/", color: "#ffffff" },
          { linkColor: "#aa0000" },
        ),
      );

      expect(
        navItems(html).every((item) => styleOf(item)["color"] === "#ffffff"),
      ).toBe(true);
    });

    it("keeps the links in one row in classic Outlook, a cell each, separators too", () => {
      const html = markup(nav(shopAbout, { separator: "|" }));

      expect(html).toContain(
        '<!--[if mso]><table role="presentation" align="center" dir="ltr" ' +
          'border="0" cellpadding="0" cellspacing="0"><tr>' +
          '<td style="padding-right:16px"><![endif]--><a href="https://example.com/shop"',
      );
      expect(html).toContain(
        '</a><!--[if mso]></td><td style="padding-right:16px"><![endif]--><span',
      );
      expect(html).toContain(
        '</span><!--[if mso]></td><td style="padding-right:0"><![endif]-->' +
          '<a href="https://example.com/about"',
      );
      expect(html).toContain(
        "</a><!--[if mso]></td></tr></table><![endif]--></td>",
      );
    });

    it("pads and paints its cell", () => {
      const cell = navCell(
        markup(
          nav(shopAbout, {
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
      const html = markup(nav(shopAbout, {}, {}, { align: "start" }));

      expect(html).toContain(".lekh-m-subject{text-align:left!important}");
      expect(tagsWearingOverride(html)).toEqual(["td"]);
      expect(styleOf(overriddenCell(html))["line-height"]).toBe("20px");
    });

    it("hides its whole table on a phone when desktop only", () => {
      const html = markup(nav(shopAbout, { showOn: "desktop" }));

      expect(outermost(html)?.localName).toBe("table");
      expect(outermost(html)?.getAttribute("class")).toBe("lekh-hidden");
    });

    it("stacks its links on a phone and hides the separators, when asked", () => {
      const html = markup(
        nav(shopAbout, { separator: "|", stackOnMobile: true, gap: 12 }),
      );

      expect(navItems(html).map((item) => item.getAttribute("class"))).toEqual([
        "lekh-nav-stack-12",
        "lekh-nav-sep",
        "lekh-nav-stack-0",
      ]);
      expect(html).toContain(
        ".lekh-nav-stack-12{display:block!important;padding-left:0!important;" +
          "padding-right:0!important;padding-bottom:12px!important}",
      );
      expect(html).toContain(
        ".lekh-nav-stack-0{display:block!important;padding-left:0!important;" +
          "padding-right:0!important;padding-bottom:0!important}",
      );
      expect(html).toContain(".lekh-nav-sep{display:none!important}");
      expect(stylesheetOf(html)).toContain(
        "@media only screen and (max-width:480px)",
      );
    });

    it("does not stack unless asked", () => {
      const html = markup(nav(shopAbout, { separator: "|" }));

      expect(html).not.toContain("lekh-nav-");
    });
  });

  describe("in the editor", () => {
    it("seeds three links, labelled in order", () => {
      const editor = editorWithIcons();
      const navId = placeNav(editor);

      expect(
        (editor.getBlock(navId)?.children ?? []).map((link) => link.props),
      ).toEqual([
        { label: "Link 1" },
        { label: "Link 2" },
        { label: "Link 3" },
      ]);
    });

    it("goes down to one link and no further", () => {
      const editor = editorWithIcons();
      const navId = placeNav(editor);
      const [first, second, third] = editor.getBlock(navId)?.children ?? [];

      expect(editor.removeBlock(first?.id ?? "")).toBe(true);
      expect(editor.removeBlock(second?.id ?? "")).toBe(true);
      expect(editor.removeBlock(third?.id ?? "")).toBe(false);
    });

    it("goes up to eight links and no further", () => {
      const editor = editorWithIcons();
      const navId = placeNav(editor);
      for (let at = 3; at < 8; at += 1) {
        expect(editor.insertBlock("nav-link", navId)).toBeDefined();
      }

      expect(editor.insertBlock("nav-link", navId)).toBeUndefined();
      expect(editor.getBlock(navId)?.children).toHaveLength(8);
    });

    it("calls a link with no label an error, and one with no address a warning", () => {
      const editor = createEditor({
        definitions,
        rootType: REACT_EMAIL_ROOT_TYPE,
        document: nav([
          { label: "  ", href: "https://example.com" },
          { label: "Shop" },
          shopAbout[1] ?? {},
        ]),
      });

      expect(editor.getDiagnostics()).toEqual([
        {
          code: "nav-link-label-missing",
          message: "This link has no label, so the email leaves it out.",
          severity: "error",
          blockId: "link-0",
          prop: "label",
        },
        {
          code: "nav-link-href-missing",
          message: "This link does not go anywhere.",
          severity: "warning",
          blockId: "link-1",
          prop: "href",
        },
      ]);
    });
  });
});
