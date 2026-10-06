import { describe, expect, it } from "vitest";

import { createEditor } from "../index";
import { REACT_EMAIL_ROOT_TYPE } from "../blocks";
import { parseMarkup, styleOf } from "../testing/markup";
import { createFakeTextEngine } from "../testing/text-engine";
import {
  definitions,
  markup,
  stylesOf,
  alone,
  paragraphStyles,
  schemaOf,
} from "../testing/preset";

/** The bottom margin of every `<p>` in the markup, in order. */
function paragraphGaps(html: string): (string | undefined)[] {
  return paragraphStyles(html).map((style) => style["margin-bottom"]);
}

// ADR-0023: the text Block holds paragraphs; the heading stays one line.
describe("the text Block's paragraphs", () => {
  const THREE = "<p>One</p><p>Two</p><p>Three</p>";

  it("writes the Block's style on every paragraph, and no gap after the last", () => {
    const html = markup(
      alone(
        {
          id: "copy",
          type: "text",
          props: { content: THREE, color: "#123456" },
        },
        { fontFamily: "Georgia, serif" },
      ),
    );
    const styles = paragraphStyles(html);

    expect(styles).toHaveLength(3);
    for (const style of styles) {
      expect(style).toMatchObject({
        color: "#123456",
        "font-family": "Georgia, serif",
        "font-size": "1em",
        "margin-top": "0",
      });
      // The cell aligns the text, and every paragraph inherits it.
      expect(style).not.toHaveProperty("text-align");
    }
    expect(paragraphGaps(html)).toEqual(["16px", "16px", "0"]);
  });

  it("spaces the paragraphs by paragraphSpacing", () => {
    const html = markup(
      alone({
        id: "copy",
        type: "text",
        props: { content: THREE, paragraphSpacing: 8 },
      }),
    );

    expect(paragraphGaps(html)).toEqual(["8px", "8px", "0"]);
  });

  it("puts the size, alignment and background on the cell, and the hide class outside it", () => {
    const html = markup(
      alone({
        id: "subject",
        type: "text",
        props: {
          content: THREE,
          fontSize: 18,
          align: "center",
          backgroundColor: "#fafafa",
          showOn: "desktop",
        },
        mobile: { fontSize: 14 },
      }),
    );
    const cell = parseMarkup(html).one("td.lekh-m-subject");

    expect(styleOf(cell)).toMatchObject({
      "font-size": "18px",
      "text-align": "center",
      "background-color": "#fafafa",
    });
    expect(cell.getAttribute("align")).toBe("center");
    expect(parseMarkup(html).all('table[class="lekh-hidden"]')).not.toEqual([]);
  });

  it("writes a value with no paragraph in it as one", () => {
    const html = markup(
      alone({ id: "copy", type: "text", props: { content: "a<br />b" } }),
    );

    expect(parseMarkup(html).one("p").innerHTML).toBe("a<br>b");
    expect(paragraphGaps(html)).toEqual(["0"]);
  });

  it("keeps the paragraphs typed into text, and makes them breaks in a heading", () => {
    const engine = createFakeTextEngine();
    const editor = createEditor({
      definitions,
      rootType: REACT_EMAIL_ROOT_TYPE,
      textEngine: engine,
    });
    const root = editor.getDocument().root.id;
    const text = editor.insertBlock("text", root) ?? "";
    const heading = editor.insertBlock("heading", root) ?? "";

    for (const id of [text, heading]) {
      engine.type(id, "<p>a</p><p>b</p>");
      editor.markTextEdit(id);
    }

    expect(editor.getBlock(text)?.props["content"]).toBe("<p>a</p><p>b</p>");
    expect(editor.getBlock(heading)?.props["content"]).toBe("a<br />b");
  });

  it("offers paragraphSpacing as a number that is not Overridable", () => {
    const entry = definitions.find((definition) => definition.type === "text")
      ?.schema["paragraphSpacing"];

    expect(entry).toMatchObject({
      kind: "number",
      defaultValue: 16,
      constraints: { min: 0, unit: "px" },
    });
    expect(entry).not.toHaveProperty("mobile");
  });
});

/** Every `<ul>` or `<ol>` in the markup, in order. */
function lists(html: string): readonly Element[] {
  return parseMarkup(html).all("ul, ol");
}

/** The style of the first list in the markup. */
function listStyle(html: string): Readonly<Record<string, string>> {
  const [list] = lists(html);
  return list ? styleOf(list) : {};
}

/** The style of every styled `<li>` in the markup, in order. */
function itemStyles(html: string): readonly Readonly<Record<string, string>>[] {
  return stylesOf(html, "li[style]");
}

// ADR-0029: the text Block holds bullet and numbered lists.
describe("the text Block's lists", () => {
  const BULLETS = "<p>Intro</p><ul><li>One</li><li>Two</li></ul><p>Outro</p>";

  it("writes a bullet list with a physical indent, no padding and a bullet for Outlook", () => {
    const html = markup(
      alone(
        {
          id: "copy",
          type: "text",
          props: { content: BULLETS, color: "#123456", fontSize: 16 },
        },
        { fontFamily: "Georgia, serif" },
      ),
    );
    const [list] = lists(html);

    expect(list?.localName).toBe("ul");
    expect(list?.hasAttribute("dir")).toBe(false);
    const style = listStyle(html);
    expect(style["margin-left"]).toBe("24px");
    expect(style["margin-right"]).toBe("0");
    expect(style["margin-bottom"]).toBe("16px");
    expect(style["padding"]).toBe("0");
    expect(style["list-style-type"]).toBe("disc");
    expect(style["color"]).toBe("#123456");

    const items = itemStyles(html);
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item["mso-special-format"]).toBe("bullet");
      expect(item["padding"]).toBe("0");
      expect(item["font-size"]).toBe("1em");
      expect(item["color"]).toBe("#123456");
      expect(item["font-family"]).toBe("Georgia, serif");
      expect(item).not.toHaveProperty("text-align");
    }
    expect(items.map((item) => item["margin-bottom"])).toEqual(["4px", "0"]);
  });

  it("writes a numbered list as decimal, with no Outlook bullet", () => {
    const html = markup(
      alone({
        id: "copy",
        type: "text",
        props: { content: "<ol><li>One</li><li>Two</li></ol>" },
      }),
    );
    const [list] = lists(html);

    expect(list?.localName).toBe("ol");
    expect(listStyle(html)["list-style-type"]).toBe("decimal");
    for (const attribute of ["start", "reversed", "value", "type"]) {
      expect(list?.hasAttribute(attribute)).toBe(false);
    }
    for (const item of itemStyles(html)) {
      expect(item).not.toHaveProperty("mso-special-format");
    }
  });

  it("indents by one and a half times the font size", () => {
    const html = markup(
      alone({
        id: "copy",
        type: "text",
        props: { content: BULLETS, fontSize: 20 },
      }),
    );
    const style = listStyle(html);

    expect(style["margin-left"]).toBe("30px");
  });

  it("indents from the right, and says so, in an email that runs right to left", () => {
    const html = markup(
      alone(
        { id: "copy", type: "text", props: { content: BULLETS } },
        { direction: "rtl" },
      ),
    );
    const [list] = lists(html);
    const style = listStyle(html);

    expect(list?.getAttribute("dir")).toBe("rtl");
    expect(style["margin-right"]).toBe("24px");
    expect(style["margin-left"]).toBe("0");
  });

  it("spaces the items by listItemSpacing and the list by paragraphSpacing", () => {
    const html = markup(
      alone({
        id: "copy",
        type: "text",
        props: {
          content: BULLETS,
          listItemSpacing: 10,
          paragraphSpacing: 20,
        },
      }),
    );
    const style = listStyle(html);

    expect(style["margin-bottom"]).toBe("20px");
    expect(itemStyles(html).map((item) => item["margin-bottom"])).toEqual([
      "10px",
      "0",
    ]);
    expect(paragraphGaps(html)).toEqual(["20px", "0"]);
  });

  it("puts no space below a list that ends the text", () => {
    const html = markup(
      alone({
        id: "copy",
        type: "text",
        props: { content: "<p>Intro</p><ol><li>One</li></ol>" },
      }),
    );
    const style = listStyle(html);

    expect(style["margin-bottom"]).toBe("0");
    expect(paragraphGaps(html)).toEqual(["16px"]);
  });

  it("keeps the lists typed into text, and makes them breaks in a heading", () => {
    const engine = createFakeTextEngine();
    const editor = createEditor({
      definitions,
      rootType: REACT_EMAIL_ROOT_TYPE,
      textEngine: engine,
    });
    const root = editor.getDocument().root.id;
    const text = editor.insertBlock("text", root) ?? "";
    const heading = editor.insertBlock("heading", root) ?? "";

    for (const id of [text, heading]) {
      engine.type(id, "<ul><li>a</li><li>b</li></ul>");
      editor.markTextEdit(id);
    }

    expect(editor.getBlock(text)?.props["content"]).toBe(
      "<ul><li>a</li><li>b</li></ul>",
    );
    expect(editor.getBlock(heading)?.props["content"]).toBe("a<br />b");
  });

  it("offers listItemSpacing as a number that is not Overridable", () => {
    const entry = definitions.find((definition) => definition.type === "text")
      ?.schema["listItemSpacing"];

    expect(entry).toMatchObject({
      kind: "number",
      defaultValue: 4,
      constraints: { min: 0, max: 48, unit: "px" },
    });
    expect(entry).not.toHaveProperty("mobile");
  });

  it("lets the text hold lists, and not the heading", () => {
    expect(schemaOf("text")?.["content"]?.constraints).toMatchObject({
      paragraphs: true,
      lists: true,
    });
    expect(
      schemaOf("heading")?.["content"]?.constraints?.["lists"],
    ).toBeUndefined();
  });
});

// #168: the stored level stays a number; the Author reads the tag.
describe("the heading's level", () => {
  it("labels 1, 2 and 3 as H1, H2 and H3", () => {
    expect(schemaOf("heading")?.["level"]?.constraints?.["options"]).toEqual([
      { label: "H1", value: 1 },
      { label: "H2", value: 2 },
      { label: "H3", value: 3 },
    ]);
  });
});
