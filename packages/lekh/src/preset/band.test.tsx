import { describe, expect, it } from "vitest";

import {
  SchemaKind,
  createEditor,
  NONE,
  type Block,
  type EmailDocument,
} from "../index";
import { PresetDiagnostic, REACT_EMAIL_ROOT_TYPE } from "../blocks";
import { parseMarkup, styleOf } from "../testing/markup";
import {
  alone,
  commentsIn,
  containerTable,
  definitions,
  markup,
  placed,
} from "../testing/preset";
import { block, documentOf } from "../testing/tree";

/** What sits between the end of the opening half and the closing half. */
const between = (html: string): string => {
  const open = html.indexOf("<v:textbox");
  const start = html.indexOf("<![endif]-->", open) + "<![endif]-->".length;
  const end = html.indexOf("<!--[if mso]></v:textbox>");
  return html.slice(start, end);
};

/** The cell carrying the background: the one with the image on it. */
const backgroundCell = (html: string): Element =>
  parseMarkup(html).one("td[style*='background-image']");

// #73, ADR-0026: section and row hold a background image behind their content.
describe("a content background image", () => {
  const BACKDROP = {
    src: "https://cdn.example.com/sky.jpg",
    width: 1200,
    height: 800,
    alt: "Ignored: a background is decoration",
  };

  const withBackdrop = (
    type: "section" | "columns",
    props: Record<string, unknown> = {},
  ): EmailDocument => {
    const children: Block[] =
      type === "section"
        ? [{ id: "copy", type: "text", props: { content: "Over the sky" } }]
        : [
            { id: "left", type: "column", props: {}, children: [] },
            { id: "right", type: "column", props: {}, children: [] },
          ];
    return alone({
      id: "subject",
      type,
      props: {
        contentBackgroundImage: BACKDROP,
        contentBackgroundColor: "#123456",
        ...props,
      },
      children,
    });
  };

  it("is an optional Asset in the Content group, next to the color", () => {
    for (const type of ["section", "columns"]) {
      const schema = definitions.find((d) => d.type === type)?.schema ?? {};
      const names = Object.keys(schema);
      expect(schema["contentBackgroundImage"]).toMatchObject({
        kind: SchemaKind.asset,
        label: "Content background image",
        defaultValue: undefined,
        group: "Content",
      });
      expect(schema["contentBackgroundImage"]?.primary).toBeUndefined();
      expect("mobile" in (schema["contentBackgroundImage"] ?? {})).toBe(false);
      expect(names.indexOf("contentBackgroundImage")).toBe(
        names.indexOf("contentBackgroundColor") + 1,
      );
    }
  });

  it("marks the image Block's Asset as the one it is", () => {
    const schema = definitions.find((d) => d.type === "image")?.schema;
    expect(schema?.["asset"]?.primary).toBe(true);
  });

  // #166: the reason says whether a picture is already there. #175: and a
  // background is decorative, so a picker asks no alt text for it.
  it.each([
    ["add", "an empty", "section", { contentBackgroundImage: undefined }],
    ["replace", "a set", "section", {}],
    ["add", "an empty", "columns", { contentBackgroundImage: undefined }],
    ["replace", "a set", "columns", {}],
  ] as const)("asks to %s %s %s background", (reason, _, type, props) => {
    const editor = createEditor({
      definitions,
      rootType: REACT_EMAIL_ROOT_TYPE,
      document: withBackdrop(type, props),
      resolveImage: () => new Promise(() => {}),
    });

    editor.replaceImage("subject", "replace", "contentBackgroundImage");

    expect(editor.getImageRequests()).toMatchObject([
      {
        reason,
        placement: {
          kind: "replace",
          blockId: "subject",
          prop: "contentBackgroundImage",
          decorative: true,
        },
      },
    ]);
  });

  it("places a section without asking for a picture", () => {
    const editor = createEditor({
      definitions,
      rootType: REACT_EMAIL_ROOT_TYPE,
      resolveImage: () => new Promise(() => {}),
    });

    expect(editor.place({ reason: "insert", type: "section" }).status).toBe(
      "inserted",
    );
    expect(editor.getImageRequests()).toEqual([]);
    expect(editor.getImageBlockType()).toBe("image");
  });

  it.each(["section", "columns"] as const)(
    "covers a %s's content, centred and unrepeated, over its color",
    (type) => {
      const cell = backgroundCell(markup(withBackdrop(type)));

      expect(styleOf(cell)).toMatchObject({
        "background-image": 'url("https://cdn.example.com/sky.jpg")',
        "background-size": "cover",
        "background-position": "center",
        "background-repeat": "no-repeat",
        "background-color": "#123456",
      });
      expect(cell.getAttribute("bgcolor")).toBe("#123456");
    },
  );

  it.each(["section", "columns"] as const)(
    "draws a %s's image for classic Outlook, round one div in the cell",
    (type) => {
      const html = markup(withBackdrop(type));

      expect(html).toContain(
        '<!--[if mso]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" ' +
          'fill="true" stroke="false" ' +
          'style="width:600px;mso-fit-shape-to-text:true">' +
          '<v:fill type="frame" src="https://cdn.example.com/sky.jpg" ' +
          'color="#123456" aspect="atleast"/>' +
          '<v:textbox inset="0,0,0,0"><![endif]-->',
      );
      expect(html).toContain(
        "<!--[if mso]></v:textbox></v:rect><![endif]--></td>",
      );

      const inside = between(html);
      expect(inside.startsWith("<div>")).toBe(true);
      expect(inside.endsWith("</div>")).toBe(true);
      // One div: the first one opened is the last one closed.
      expect(inside.slice("<div>".length, -"</div>".length)).toContain(
        type === "section" ? "Over the sky" : "<table",
      );
      // The rectangle opens inside the cell, before anything else in it.
      expect(
        commentsIn(backgroundCell(html))[0]?.startsWith("[if mso]><v:rect"),
      ).toBe(true);
    },
  );

  it("fits Outlook's rectangle inside the cell's padding and the border", () => {
    const padded = { paddingLeft: 24, paddingRight: 16 };

    expect(markup(withBackdrop("columns", padded))).toContain(
      'style="width:560px;mso-fit-shape-to-text:true"',
    );
    for (const type of ["section", "columns"] as const) {
      expect(
        markup(withBackdrop(type, { ...padded, borderWidth: 2 })),
      ).toContain('style="width:556px;mso-fit-shape-to-text:true"');
    }
  });

  it("leaves the color off the Outlook fill when there is none", () => {
    const html = markup(
      withBackdrop("section", { contentBackgroundColor: NONE }),
    );

    expect(html).toContain(
      '<v:fill type="frame" src="https://cdn.example.com/sky.jpg" aspect="atleast"/>',
    );
    expect(backgroundCell(html).hasAttribute("bgcolor")).toBe(false);
  });

  it("draws neither half and no background without an image", () => {
    const html = markup(
      withBackdrop("section", { contentBackgroundImage: undefined }),
    );

    expect(html).not.toContain("v:rect");
    expect(html).not.toContain("background-image");
    expect(html).not.toContain("background-size");
  });

  it("ignores the Asset's alternative text", () => {
    expect(markup(withBackdrop("section"))).not.toContain("Ignored");
  });

  it("escapes a hostile URL in both the CSS and the VML", () => {
    const html = markup(
      withBackdrop("section", {
        contentBackgroundImage: {
          ...BACKDROP,
          src: `https://x.example/a"b'c<d>e(f).jpg`,
        },
        contentBackgroundColor: '#fff" onload="x',
      }),
    );

    expect(html).toContain(
      "url(&quot;https://x.example/a%22b%27c%3Cd%3Ee%28f%29.jpg&quot;)",
    );
    expect(html).toContain(
      'src="https://x.example/a%22b%27c%3Cd%3Ee%28f%29.jpg"',
    );
    expect(html).not.toContain('a"b');
    expect(html).not.toContain("c<d");
    expect(html).not.toContain('onload="x');
  });

  it.each([
    ["a script URL", "javascript:alert(1)"],
    ["an HTML data URL", "data:text/html,<script>alert(1)</script>"],
  ])("draws no image, and warns of nothing, from %s", (_, src) => {
    for (const type of ["section", "columns"] as const) {
      const document = withBackdrop(type, {
        contentBackgroundImage: { ...BACKDROP, src },
        contentBackgroundColor: NONE,
      });
      const html = markup(document);

      expect(html).not.toContain("alert");
      expect(html).not.toContain("v:rect");
      expect(html).toBe(
        markup(
          withBackdrop(type, {
            contentBackgroundImage: undefined,
            contentBackgroundColor: NONE,
          }),
        ),
      );
      expect(
        createEditor({ definitions, rootType: REACT_EMAIL_ROOT_TYPE, document })
          .getDiagnostics()
          .filter(
            (d) => d.code === PresetDiagnostic.backgroundImageColorMissing,
          ),
      ).toEqual([]);
    }
  });

  it("names the VML namespaces and fixes Outlook's DPI in every email", () => {
    const html = markup(alone({ id: "copy", type: "text", props: {} }));

    expect(html).toContain('xmlns:v="urn:schemas-microsoft-com:vml"');
    expect(html).toContain('xmlns:o="urn:schemas-microsoft-com:office:office"');
    expect(html).toContain(
      "<!--[if mso]><xml><o:OfficeDocumentSettings>" +
        "<o:PixelsPerInch>96</o:PixelsPerInch>" +
        "</o:OfficeDocumentSettings></xml><![endif]-->",
    );
    expect(parseMarkup(html).one("head").innerHTML).toContain("PixelsPerInch");
  });

  it("warns when there is no color to read the text on with images off", () => {
    const editor = createEditor({
      definitions,
      rootType: REACT_EMAIL_ROOT_TYPE,
      document: withBackdrop("section", { contentBackgroundColor: NONE }),
    });

    expect(
      editor
        .getDiagnostics()
        .filter((d) => d.code === "background-image-color-missing"),
    ).toMatchObject([{ blockId: "subject", severity: "warning" }]);
  });

  it("warns on a row the same way", () => {
    const editor = createEditor({
      definitions,
      rootType: REACT_EMAIL_ROOT_TYPE,
      document: withBackdrop("columns", { contentBackgroundColor: NONE }),
    });

    expect(
      editor
        .getDiagnostics()
        .filter((d) => d.code === "background-image-color-missing"),
    ).toMatchObject([{ blockId: "subject", severity: "warning" }]);
  });

  it.each([
    ["a color", { contentBackgroundColor: "#ffffff" }],
    [
      "no image",
      { contentBackgroundImage: undefined, contentBackgroundColor: NONE },
    ],
  ])("stays silent with %s", (_, props) => {
    const editor = createEditor({
      definitions,
      rootType: REACT_EMAIL_ROOT_TYPE,
      document: withBackdrop("columns", props),
    });

    expect(
      editor
        .getDiagnostics()
        .filter((d) => d.code === "background-image-color-missing"),
    ).toEqual([]);
  });
});

const banded = (
  rootProps: Record<string, unknown>,
  own: Record<string, unknown> = {},
): EmailDocument =>
  documentOf(
    block(REACT_EMAIL_ROOT_TYPE, rootProps, [
      block("section", { id: "section", ...own }, []),
      block("columns", { id: "row", ...own }, [
        block("column", {}, []),
        block("column", {}, []),
      ]),
    ]),
  );

// #168: the band's own colour reaches the window's edges; the Content one is
// the background an Author means.
describe("a band's two colour labels", () => {
  it.each(["section", "columns"])(
    "names a %s Block's colors in an Author's words",
    (type) => {
      const editor = createEditor({
        definitions,
        document: documentOf(
          block(REACT_EMAIL_ROOT_TYPE, { id: "root" }, [
            block(type, { id: "subject" }),
          ]),
        ),
      });
      editor.select("subject");
      const labelOf = (name: string) =>
        editor.getControls().find((control) => control.name === name)?.label;

      expect(labelOf("backgroundColor")).toBe("Full-width background color");
      expect(labelOf("contentBackgroundColor")).toBe("Background color");
    },
  );
});

/** The content colour of each band's column, in order. */
const columnColors = (html: string): (string | undefined)[] =>
  parseMarkup(html)
    .all("table[style*='max-width']")
    .map((table) => styleOf(table)["background-color"]);

// #138, ADR-0022: the root sets one content column color the bands follow.
describe("the email's content column color", () => {
  it("colors every section and row with no color of its own", () => {
    expect(
      columnColors(markup(banded({ contentBackgroundColor: "#ffffff" }))),
    ).toEqual(["#ffffff", "#ffffff"]);
  });

  it("keeps a band's own color, and a band storing none stays clear", () => {
    const root = { contentBackgroundColor: "#ffffff" };

    expect(
      columnColors(markup(banded(root, { contentBackgroundColor: "#abcdef" }))),
    ).toEqual(["#abcdef", "#abcdef"]);
    expect(
      columnColors(markup(banded(root, { contentBackgroundColor: NONE }))),
    ).toEqual([undefined, undefined]);
  });

  it("tells the Inspector a band's color is the email's, until it sets its own", () => {
    const editor = createEditor({
      definitions,
      rootType: REACT_EMAIL_ROOT_TYPE,
      document: banded({ contentBackgroundColor: "#ffffff" }),
    });
    const control = () => {
      editor.select("section");
      return editor
        .getControls()
        .find((found) => found.name === "contentBackgroundColor");
    };

    expect(control()).toMatchObject({ value: "#ffffff", origin: "email" });
    editor.setProp("section", "contentBackgroundColor", "#abcdef");
    expect(control()).toMatchObject({ value: "#abcdef", origin: "block" });
  });

  it("gives a band's image the email's column color to fall back on", () => {
    const editor = createEditor({
      definitions,
      rootType: REACT_EMAIL_ROOT_TYPE,
      document: banded(
        { contentBackgroundColor: "#ffffff" },
        {
          contentBackgroundImage: {
            src: "https://cdn.example.com/sky.jpg",
            width: 1200,
            height: 800,
          },
        },
      ),
    });

    expect(
      editor
        .getDiagnostics()
        .filter((d) => d.code === PresetDiagnostic.backgroundImageColorMissing),
    ).toEqual([]);
    expect(markup(editor.getDocument())).toContain(
      'color="#ffffff" aspect="atleast"',
    );
  });

  it("colors nothing while the email's column color is none", () => {
    expect(markup(banded({ contentBackgroundColor: NONE }))).toBe(
      markup(banded({})),
    );
  });
});

// #70, #106: Section and Columns draw the same border in the same place, so
// two stacked with the same border and padding line up.
describe("a band's border", () => {
  it.each([
    ["section", "section"],
    ["row", "columns"],
  ])(
    "draws a %s's border round its content, outside its padding",
    (_, type) => {
      const html = markup(
        placed(type, {
          borderWidth: 2,
          borderStyle: "dashed",
          borderColor: "#ff0000",
          borderRadius: 8,
          paddingTop: 24,
        }),
      );
      const container = containerTable(html);

      expect(container["border"]).toBe("2px dashed #ff0000");
      expect(container["border-radius"]).toBe("8px");
      expect(html.split("#ff0000")).toHaveLength(2);
      // The padding is on a cell inside the bordered table.
      expect(
        parseMarkup(html)
          .one("table[style*='max-width']")
          .querySelector("td[style*='padding-top:24px']"),
      ).not.toBeNull();
    },
  );
});
