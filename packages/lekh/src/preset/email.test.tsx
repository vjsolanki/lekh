import { describe, expect, it } from "vitest";

import {
  createCompliancePreset,
  createReactEmailPreset,
  PresetDiagnostic,
  REACT_EMAIL_ROOT_TYPE,
  type ReactEmailFontFace,
  type ReactEmailPresetOptions,
} from "../blocks";
import { createEditor, NONE, type EmailDocument } from "../index";
import {
  markupOf,
  outlookMarkup,
  parseMarkup,
  styleOf,
} from "../testing/markup";
import {
  definitions,
  DEFAULT_FONT_STACK,
  markup,
  stylesOf,
  alone,
  attributesOf,
  wrapper,
  BODY_CELL,
  directed,
  valuesOf,
  unchecked,
} from "../testing/preset";

/** One of each text-bearing Block, under a root carrying these props. */
function lettered(rootProps: Record<string, unknown>): EmailDocument {
  return {
    root: {
      id: "root",
      type: REACT_EMAIL_ROOT_TYPE,
      props: rootProps,
      children: [
        { id: "title", type: "heading", props: { content: "Hello" } },
        { id: "copy", type: "text", props: { content: "Some words." } },
        {
          id: "cta",
          type: "button",
          props: { label: "Read on", href: "https://example.com" },
        },
      ],
    },
  };
}

/** How many elements the markup writes this stack onto. */
function wearing(html: string, stack: string): number {
  return stylesOf(html, "*").filter((style) => style["font-family"] === stack)
    .length;
}

function fontControl(set = definitions) {
  const editor = createEditor({
    definitions: set,
    rootType: REACT_EMAIL_ROOT_TYPE,
  });
  editor.select(editor.getDocument().root.id);
  return editor.getControls().find((control) => control.name === "fontFamily");
}

// ADR-0021: the font is Document data, picked from the Consumer's list.
describe("the email's font", () => {
  it("writes the root's stack on the body and on every text-bearing Block", () => {
    const html = markup(lettered({ fontFamily: "Georgia, serif" }));

    // Body, heading, text and button: the body's font does not reach into
    // tables in every client, so each element carries its own.
    expect(wearing(html, "Georgia, serif")).toBe(4);
    expect(html).not.toContain(DEFAULT_FONT_STACK);
  });

  it("renders a stack the Consumer never listed exactly as it was stored", () => {
    const html = markup(lettered({ fontFamily: "Palatino, serif" }));

    expect(wearing(html, "Palatino, serif")).toBe(4);
  });

  it("renders a Document with no font of its own as it always has", () => {
    const stored = lettered({});

    expect(markup(stored)).toBe(
      markup(lettered({ fontFamily: DEFAULT_FONT_STACK })),
    );
    expect(wearing(markup(stored), DEFAULT_FONT_STACK)).toBe(4);
  });

  it("falls back to the default for a stack that is not safe to emit", () => {
    const html = markup(lettered({ fontFamily: "Arial; background: url(x)" }));

    expect(html).not.toContain("url(x)");
    expect(wearing(html, DEFAULT_FONT_STACK)).toBe(4);
  });

  it("treats a quote that never closes as unsafe", () => {
    // An open string would swallow every declaration written after it.
    for (const fontFamily of ["'Foo, serif", `"a'b", 'c`, `Foo"bar`]) {
      expect(
        wearing(markup(lettered({ fontFamily })), DEFAULT_FONT_STACK),
      ).toBe(4);
    }
    expect(
      wearing(
        markup(
          lettered({ fontFamily: `"Times New Roman", 'Noto Serif', serif` }),
        ),
        `"Times New Roman", 'Noto Serif', serif`,
      ),
    ).toBe(4);
  });

  it("refuses a font list it could never render", () => {
    expect(() =>
      createReactEmailPreset({ fontFamily: "Arial; color: red" }),
    ).toThrow(/font/iu);
    expect(() =>
      createReactEmailPreset({
        fonts: [{ label: "Broken", stack: "Arial}" }],
      }),
    ).toThrow(/Broken/u);
  });

  it("flags an unsafe stack, with a Repair that puts the default back", () => {
    const editor = createEditor({
      definitions,
      document: lettered({ fontFamily: "Arial; background: url(x)" }),
    });
    const flagged = editor
      .getDiagnostics()
      .filter((finding) => finding.code === PresetDiagnostic.fontFamilyUnsafe);

    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.blockId).toBe("root");

    const repair = flagged[0]?.repair;
    if (repair) editor.applyRepair(repair);

    expect(editor.getDocument().root.props["fontFamily"]).toBeUndefined();
    expect(
      editor
        .getDiagnostics()
        .filter(
          (finding) => finding.code === PresetDiagnostic.fontFamilyUnsafe,
        ),
    ).toEqual([]);
  });

  it("flags nothing about a listed, unlisted or absent stack", () => {
    for (const fontFamily of [undefined, "Palatino, serif"]) {
      const editor = createEditor({
        definitions,
        document: lettered(fontFamily === undefined ? {} : { fontFamily }),
      });

      expect(
        editor
          .getDiagnostics()
          .filter(
            (finding) => finding.code === PresetDiagnostic.fontFamilyUnsafe,
          ),
      ).toEqual([]);
    }
  });

  it("offers the default alone when the Consumer lists no fonts", () => {
    const control = fontControl();

    expect(control?.kind).toBe("select");
    expect(control?.value).toBe(DEFAULT_FONT_STACK);
    expect(control?.constraints).toEqual({
      options: [{ label: "Default", value: DEFAULT_FONT_STACK }],
    });
  });

  it("offers the Consumer's fonts after the default, by label", () => {
    const control = fontControl(
      createReactEmailPreset({
        fontFamily: "Inter, Arial, sans-serif",
        fonts: [
          { label: "Serif", stack: "Georgia, serif" },
          { label: "Mono", stack: "Courier, monospace" },
        ],
      }),
    );

    expect(control?.value).toBe("Inter, Arial, sans-serif");
    expect(control?.constraints).toEqual({
      options: [
        { label: "Default", value: "Inter, Arial, sans-serif" },
        { label: "Serif", value: "Georgia, serif" },
        { label: "Mono", value: "Courier, monospace" },
      ],
    });
  });

  it("keeps the Consumer's own label and place for the default", () => {
    const control = fontControl(
      createReactEmailPreset({
        fontFamily: "Inter, Arial, sans-serif",
        fonts: [
          { label: "Serif", stack: "Georgia, serif" },
          { label: "Brand", stack: "Inter, Arial, sans-serif" },
        ],
      }),
    );

    expect(control?.constraints).toEqual({
      options: [
        { label: "Serif", value: "Georgia, serif" },
        { label: "Brand", value: "Inter, Arial, sans-serif" },
      ],
    });
  });

  it("is not a Mobile Override", () => {
    const editor = createEditor({
      definitions,
      rootType: REACT_EMAIL_ROOT_TYPE,
      stage: "mobile",
    });
    editor.select(editor.getDocument().root.id);

    expect(editor.getControls().map((control) => control.name)).not.toContain(
      "fontFamily",
    );
  });
});

const BRAND = "Inter, Arial, sans-serif";
const INTER_400 = "https://cdn.example.com/inter-400.woff2";
const INTER_700 = "https://cdn.example.com/inter-700.woff2";

/** A Preset whose default font is listed with a web font of these faces. */
function branded(
  faces: readonly ReactEmailFontFace[] = [{ url: INTER_400 }],
  options: Omit<ReactEmailPresetOptions, "fonts"> = {},
) {
  return createReactEmailPreset({
    fontFamily: BRAND,
    ...options,
    fonts: [
      { label: "Inter", stack: BRAND, webFont: { faces } },
      { label: "Serif", stack: "Georgia, serif" },
    ],
  });
}

/** The `@font-face` stylesheet in the head, or `undefined` for none. */
function fontFacesOf(html: string): string | undefined {
  return parseMarkup(html)
    .all("head style")
    .map((style) => style.textContent ?? "")
    .find((css) => css.includes("@font-face"));
}

// #137: a listed font loads its web font, best-effort.
describe("the email's web font", () => {
  it("loads every face of the font the email is in, under its first name", () => {
    const html = markup(
      lettered({}),
      branded([
        { url: INTER_400 },
        { url: INTER_700, weight: 700 },
        { url: INTER_400, weight: 400, style: "italic" },
      ]),
    );

    expect(fontFacesOf(html)).toBe(
      "@media screen{" +
        `@font-face{font-family:'Inter';font-style:normal;font-weight:400;src:url("${INTER_400}") format('woff2')}` +
        `@font-face{font-family:'Inter';font-style:normal;font-weight:700;src:url("${INTER_700}") format('woff2')}` +
        `@font-face{font-family:'Inter';font-style:italic;font-weight:400;src:url("${INTER_400}") format('woff2')}` +
        "}",
    );
  });

  it("keeps the faces from classic Outlook, which reads no @media", () => {
    const html = markup(lettered({}), branded());

    expect(fontFacesOf(html)).toMatch(/^@media screen\{.*\}$/u);
  });

  it("writes the faces apart from the mobile rules", () => {
    const html = markup(
      {
        root: {
          id: "root",
          type: REACT_EMAIL_ROOT_TYPE,
          props: {},
          children: [
            {
              id: "copy",
              type: "text",
              props: { content: "Hi" },
              mobile: { fontSize: 12 },
            },
          ],
        },
      },
      branded(),
    );
    const sheets = parseMarkup(html)
      .all("head style")
      .map((style) => style.textContent ?? "");

    expect(sheets).toHaveLength(2);
    expect(sheets.filter((css) => css.includes("@font-face"))).toHaveLength(1);
    expect(
      sheets.filter(
        (css) => css.includes("@font-face") && css.includes("lekh-m"),
      ),
    ).toEqual([]);
  });

  it("loads a variable font's range of weights", () => {
    const html = markup(
      lettered({}),
      branded([{ url: INTER_400, weight: [300, 800] }]),
    );

    expect(fontFacesOf(html)).toContain("font-weight:300 800;");
  });

  it("names the format by the file's extension, and none for one it does not know", () => {
    const css = fontFacesOf(
      markup(
        lettered({}),
        branded([
          { url: "https://cdn.example.com/a.woff?v=2", weight: 300 },
          { url: "https://cdn.example.com/a.TTF", weight: 400 },
          { url: "https://cdn.example.com/a.otf#x", weight: 500 },
          { url: "https://cdn.example.com/a", weight: 600 },
        ]),
      ),
    );

    expect(css).toContain(
      `url("https://cdn.example.com/a.woff?v=2") format('woff')`,
    );
    expect(css).toContain(
      `url("https://cdn.example.com/a.TTF") format('truetype')`,
    );
    expect(css).toContain(
      `url("https://cdn.example.com/a.otf#x") format('opentype')`,
    );
    expect(css).toContain(`url("https://cdn.example.com/a")}`);
  });

  it("loads the font the email picked, not the default", () => {
    const set = createReactEmailPreset({
      fonts: [
        {
          label: "Inter",
          stack: BRAND,
          webFont: { faces: [{ url: INTER_400 }] },
        },
      ],
    });

    expect(fontFacesOf(markup(lettered({ fontFamily: BRAND }), set))).toContain(
      INTER_400,
    );
    expect(fontFacesOf(markup(lettered({}), set))).toBeUndefined();
  });

  it("loads nothing for a listed font with no web font, or one never listed", () => {
    const set = branded();
    for (const fontFamily of ["Georgia, serif", "Palatino, serif"]) {
      const html = markup(lettered({ fontFamily }), set);
      expect(fontFacesOf(html), fontFamily).toBeUndefined();
      expect(html, fontFamily).toBe(markup(lettered({ fontFamily })));
    }
  });

  it("loads nothing for a stack that is not safe to emit, which renders in the default", () => {
    const set = createReactEmailPreset({
      fonts: [
        {
          label: "Inter",
          stack: BRAND,
          webFont: { faces: [{ url: INTER_400 }] },
        },
      ],
    });

    expect(
      fontFacesOf(markup(lettered({ fontFamily: "Inter; x" }), set)),
    ).toBeUndefined();
  });

  it("names a quoted first family without its quotes", () => {
    const stack = "'Brand Sans', Arial, sans-serif";
    const set = createReactEmailPreset({
      fontFamily: stack,
      fonts: [
        { label: "Brand", stack, webFont: { faces: [{ url: INTER_400 }] } },
      ],
    });

    expect(fontFacesOf(markup(lettered({}), set))).toContain(
      "font-family:'Brand Sans';",
    );
  });

  it("leaves every Block writing the stack, with no rule over all of them", () => {
    const html = markup(lettered({}), branded());

    expect(wearing(html, BRAND)).toBe(4);
    expect(html).not.toMatch(/\*\s*\{/u);
  });

  it("reaches the compliance Blocks with no change to them", () => {
    const set = [
      ...branded(),
      ...createCompliancePreset({
        unsubscribeUrl: "https://esp.example/u",
        postalAddress: "1 Example Street",
      }),
    ];
    const html = markupOf(
      alone({ id: "subject", type: "postal-address", props: {} }, {}),
      { definitions: set, validate: false },
    );

    expect(fontFacesOf(html)).toContain(INTER_400);
    expect(wearing(html, BRAND)).toBeGreaterThan(1);
  });

  it("refuses a web font URL that is not a safe https URL", () => {
    for (const url of [
      "http://cdn.example.com/a.woff2",
      "javascript:alert(1)",
      "/fonts/a.woff2",
      "//cdn.example.com/a.woff2",
      'https://cdn.example.com/a.woff2") ; } body { color: red',
      "https://cdn.example.com/a.woff2'",
      "https://cdn.example.com/a\\.woff2",
      "https://cdn.example.com/</style><script>x</script>",
      "https://cdn.example.com/a b.woff2",
      "https://cdn.example.com/a\n.woff2",
    ]) {
      expect(() => branded([{ url }]), url).toThrow(/"Inter".*safe https URL/u);
    }
  });

  it("refuses a weight outside 1 to 1000, or a range that runs backwards", () => {
    for (const weight of [0, 1001, Number.NaN, [800, 300]] as const) {
      expect(
        () => branded([{ url: INTER_400, weight }]),
        String(weight),
      ).toThrow(/"Inter".*weight/u);
    }
  });

  it("refuses a style that is not normal or italic", () => {
    // A caller without the types can pass anything.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const style = "oblique" as unknown as "italic";
    expect(() => branded([{ url: INTER_400, style }])).toThrow(
      /"Inter".*style/u,
    );
  });

  it("refuses a web font with no faces", () => {
    expect(() => branded([])).toThrow(/"Inter".*no faces/u);
  });

  it("refuses a web font on a stack that starts with a generic family", () => {
    expect(() =>
      createReactEmailPreset({
        fonts: [
          {
            label: "Plain",
            stack: "sans-serif",
            webFont: { faces: [{ url: INTER_400 }] },
          },
        ],
      }),
    ).toThrow(/"Plain".*sans-serif/u);
  });

  it("refuses one stack listed twice with different web fonts", () => {
    expect(() =>
      createReactEmailPreset({
        fonts: [
          {
            label: "Inter",
            stack: BRAND,
            webFont: { faces: [{ url: INTER_400 }] },
          },
          { label: "Inter again", stack: BRAND },
        ],
      }),
    ).toThrow(/"Inter again"/u);
    expect(() =>
      createReactEmailPreset({
        fonts: [
          { label: "Inter", stack: BRAND },
          { label: "Inter again", stack: BRAND },
        ],
      }),
    ).not.toThrow();
  });
});

const LINKED =
  'Read <a href="https://example.com">this</a> or <a href="https://example.com/b">that</a>.';

/** The `color` the first styled element of a tag is written in. */
function inkOf(html: string, tag: string): string | undefined {
  return stylesOf(html, `${tag}[style]`)[0]?.["color"];
}

/** The colour written on every link in the markup, one entry per link. */
function linkInks(html: string): (string | undefined)[] {
  return stylesOf(html, "a").map((style) => style["color"]);
}

function written(
  type: string,
  props: Record<string, unknown> = {},
  rootProps: Record<string, unknown> = {},
): string {
  return markup(
    alone(
      {
        id: "subject",
        type,
        // Current, so a heading is not migrated onto the colour it used to have.
        ...(type === "heading" ? { version: 1 } : {}),
        props: { content: LINKED, ...props },
      },
      rootProps,
    ),
  );
}

function colorEditor(document?: EmailDocument) {
  const editor = createEditor({
    definitions,
    rootType: REACT_EMAIL_ROOT_TYPE,
    ...(document ? { document } : {}),
  });
  return { editor, root: editor.getDocument().root.id };
}

function colorControl(
  editor: ReturnType<typeof createEditor>,
  blockId: string,
) {
  editor.select(blockId);
  return editor.getControls().find((control) => control.name === "color");
}

// ADR-0022: the email's text and link colour live on the root.
describe("the email's text and link colors", () => {
  it("starts a new email at #333333 text and #0b57d0 links", () => {
    const { editor, root } = colorEditor();
    editor.select(root);
    const controls = editor.getControls();

    expect(controls.find((c) => c.name === "textColor")).toMatchObject({
      kind: "color",
      value: "#333333",
    });
    expect(controls.find((c) => c.name === "linkColor")).toMatchObject({
      kind: "color",
      value: "#0b57d0",
    });
  });

  it("is configurable, beside the font and the background", () => {
    const set = createReactEmailPreset({
      textColor: "#222222",
      linkColor: "#ff6600",
    });
    const html = markup(
      alone({ id: "subject", type: "text", props: { content: LINKED } }),
      set,
    );

    expect(inkOf(html, "p")).toBe("#222222");
    expect(linkInks(html)).toEqual(["#ff6600", "#ff6600"]);
  });

  it("refuses a default color it could never render", () => {
    expect(() => createReactEmailPreset({ textColor: "red; x" })).toThrow(
      /textColor/u,
    );
    expect(() => createReactEmailPreset({ linkColor: "none" })).toThrow(
      /linkColor/u,
    );
  });

  it("colors text and headings with no color of their own in the email's", () => {
    const root = { textColor: "#123456" };

    expect(inkOf(written("text", {}, root), "p")).toBe("#123456");
    expect(inkOf(written("heading", {}, root), "h1")).toBe("#123456");
  });

  it("keeps a Block's own color over the email's", () => {
    const root = { textColor: "#123456" };

    expect(inkOf(written("text", { color: "#abcdef" }, root), "p")).toBe(
      "#abcdef",
    );
    expect(inkOf(written("heading", { color: "#abcdef" }, root), "h1")).toBe(
      "#abcdef",
    );
  });

  it("keeps a stored heading with no color at #111111", () => {
    const html = markup(
      alone(
        { id: "subject", type: "heading", props: { content: "Hello" } },
        { textColor: "#123456" },
      ),
    );

    expect(inkOf(html, "h1")).toBe("#111111");
  });

  it("starts a new heading following the email", () => {
    const { editor, root } = colorEditor();
    const heading = editor.insertBlock("heading", root) ?? "";
    editor.setProp(root, "textColor", "#123456");

    expect(editor.getDocument().root.children?.[0]?.props["color"]).toBe(
      undefined,
    );
    expect(inkOf(markup(editor.getDocument()), "h1")).toBe("#123456");
    expect(colorControl(editor, heading)?.value).toBe("#123456");
  });

  it("moves the Blocks that follow when the email's color changes, and only those", () => {
    const { editor, root } = colorEditor();
    const following = editor.insertBlock("text", root) ?? "";
    const own = editor.insertBlock("text", root) ?? "";
    editor.setProp(own, "color", "#abcdef");
    editor.setProp(root, "textColor", "#123456");

    expect(colorControl(editor, following)?.value).toBe("#123456");
    expect(colorControl(editor, own)?.value).toBe("#abcdef");

    const html = markup(editor.getDocument());
    expect(html).toContain("color:#123456");
    expect(html).toContain("color:#abcdef");
  });

  it("follows the email again once a Block's own color is cleared", () => {
    const { editor, root } = colorEditor();
    const text = editor.insertBlock("text", root) ?? "";
    editor.setProp(root, "textColor", "#123456");
    editor.setProp(text, "color", "#abcdef");
    editor.setProp(text, "color", undefined);

    expect(inkOf(markup(editor.getDocument()), "p")).toBe("#123456");
  });

  it("writes the email's link color on every link in text and heading", () => {
    const root = { linkColor: "#ff6600" };

    for (const [type, own] of [
      ["text", {}],
      ["heading", {}],
      ["text", { color: "#abcdef" }],
    ] as const) {
      expect(linkInks(written(type, own, root))).toEqual([
        "#ff6600",
        "#ff6600",
      ]);
    }
    expect(linkInks(written("text"))).toEqual(["#0b57d0", "#0b57d0"]);
  });

  it("falls back to the default for a color it cannot use, and flags it", () => {
    const root = { textColor: "red; background: url(x)", linkColor: "none" };
    const html = written("text", {}, root);

    expect(html).not.toContain("url(x)");
    expect(inkOf(html, "p")).toBe("#333333");
    expect(linkInks(html)).toEqual(["#0b57d0", "#0b57d0"]);

    const { editor } = colorEditor(
      alone({ id: "copy", type: "text", props: { content: LINKED } }, root),
    );
    const flagged = editor
      .getDiagnostics()
      .filter(
        (finding) => finding.code === PresetDiagnostic.emailColorUnusable,
      );
    expect(flagged.map(({ blockId, prop }) => ({ blockId, prop }))).toEqual([
      { blockId: "root", prop: "textColor" },
      { blockId: "root", prop: "linkColor" },
    ]);

    // Carried out from the mobile Stage, they still put desktop right.
    editor.setStage("mobile");
    for (const finding of flagged) {
      if (finding.repair) editor.applyRepair(finding.repair);
    }
    expect(
      editor
        .getDiagnostics()
        .filter(
          (finding) => finding.code === PresetDiagnostic.emailColorUnusable,
        ),
    ).toEqual([]);
  });

  it("leaves the button and the compliance Blocks their own colors", () => {
    const set = [
      ...definitions,
      ...createCompliancePreset({
        unsubscribeUrl: "https://esp.example/u",
        postalAddress: "1 Example Street",
      }),
    ];
    const root = { textColor: "#123456", linkColor: "#ff6600" };
    // One Block at a time, so the compliance Blocks it leaves out are not
    // what stops the render.
    const colored = (type: string, props: Record<string, unknown>) =>
      markupOf(alone({ id: "subject", type, props }, root), {
        definitions: set,
        validate: false,
      });

    for (const type of ["button", "unsubscribe", "postal-address", "divider"]) {
      const html = colored(
        type,
        type === "button" ? { label: "Go", href: "https://example.com" } : {},
      );
      expect(html, type).not.toContain("#123456");
      expect(html, type).not.toContain("#ff6600");
    }
  });

  it("says when a control's value came from the email, and resets it", () => {
    const { editor, root } = colorEditor();
    const text = editor.insertBlock("text", root) ?? "";
    editor.setProp(root, "textColor", "#123456");

    expect(colorControl(editor, text)).toMatchObject({
      value: "#123456",
      origin: "email",
    });

    colorControl(editor, text)?.set("#abcdef");
    expect(colorControl(editor, text)).toMatchObject({
      value: "#abcdef",
      origin: "block",
    });

    colorControl(editor, text)?.reset();
    expect(editor.getDocument().root.children?.[0]?.props).not.toHaveProperty(
      "color",
    );
    expect(colorControl(editor, text)).toMatchObject({
      value: "#123456",
      origin: "email",
    });

    editor.undo();
    expect(colorControl(editor, text)?.value).toBe("#abcdef");
  });

  it("does not say a value came from the email when the email's is unusable", () => {
    const { editor } = colorEditor(
      alone(
        { id: "copy", type: "text", props: { content: "Hi" } },
        { textColor: "none" },
      ),
    );

    expect(colorControl(editor, "copy")).toMatchObject({
      value: "#333333",
      origin: "default",
    });
  });

  it("follows nothing on a prop that declares nothing", () => {
    const { editor, root } = colorEditor();
    editor.select(root);

    expect(
      editor.getControls().every((control) => control.origin !== "email"),
    ).toBe(true);
  });

  it("is not a Mobile Override", () => {
    const { editor } = colorEditor();
    editor.setStage("mobile");

    expect(
      editor
        .getControls()
        .filter((control) => ["textColor", "linkColor"].includes(control.name)),
    ).toEqual([]);
  });
});

/** Every element that writes a `lang`, as its tag and the tag it writes. */
function langs(html: string): string[] {
  return parseMarkup(html)
    .all("[lang]")
    .map((element) => `${element.localName}=${element.getAttribute("lang")}`);
}

// The email's language lives on the root, and is written in three places.
describe("the email's language", () => {
  it("writes the root's language on html, body and the wrapper cell", () => {
    const html = markup(lettered({ language: "fr-CA" }));

    expect(langs(html)).toEqual(["html=fr-CA", "body=fr-CA", "td=fr-CA"]);
    expect(wrapper(html).cell.getAttribute("lang")).toBe("fr-CA");
  });

  it("trims the stored tag before writing it", () => {
    expect(langs(markup(lettered({ language: " pt-BR " })))).toEqual([
      "html=pt-BR",
      "body=pt-BR",
      "td=pt-BR",
    ]);
  });

  it("writes no lang for an empty language", () => {
    expect(langs(markup(lettered({ language: "" })))).toEqual([]);
  });

  it.each(["en us", "<x>", "e", "1en", "en_US", "-en"])(
    "writes no lang for the malformed tag %j",
    (language) => {
      expect(langs(markup(lettered({ language })))).toEqual([]);
    },
  );

  it("writes no lang for a Document with no stored language", () => {
    const html = markup(lettered({}));

    expect(langs(html)).toEqual([]);
    expect(html).toBe(markup(lettered({ language: "" })));
    // react-email's Html used to write lang="en" here. It keeps its dir.
    const root = parseMarkup(html).one("html");
    expect(root.getAttributeNames().slice(0, 2)).toEqual(["dir", "xmlns:v"]);
    expect(root.getAttribute("dir")).toBe("ltr");
  });

  it("wraps the root's children in a cell that adds no width, padding or spacing", () => {
    const html = markup(lettered({}));
    const { table, cell } = wrapper(html);

    expect(attributesOf(table)).toEqual({
      align: "center",
      width: "100%",
      border: "0",
      cellPadding: "0",
      cellSpacing: "0",
      role: "presentation",
      style: "width:100%",
    });
    // The direction is the one thing it adds, as an attribute and a backup.
    expect(attributesOf(cell)).toEqual({ dir: "ltr", style: "direction:ltr" });
  });

  it("keeps the preview text first in the body, before the wrapper", () => {
    const html = markup(lettered({ previewText: "Hi", language: "en" }));

    expect(
      parseMarkup(html)
        .one(BODY_CELL)
        .firstElementChild?.matches("[data-skip-in-text]"),
    ).toBe(true);
    expect(wrapper(html).cell.getAttribute("lang")).toBe("en");
  });

  it("offers language as a text prop with no Mobile Override", () => {
    const entry = definitions.find(
      (definition) => definition.type === REACT_EMAIL_ROOT_TYPE,
    )?.schema["language"];

    expect(entry).toMatchObject({
      kind: "text",
      label: "Language",
      defaultValue: "",
    });
    expect(entry).not.toHaveProperty("mobile");
  });

  it("seeds a new Document with the Preset's language", () => {
    const set = createReactEmailPreset({ language: "de" });
    const editor = createEditor({
      definitions: set,
      rootType: REACT_EMAIL_ROOT_TYPE,
    });
    editor.select(editor.getDocument().root.id);

    expect(
      editor.getControls().find((control) => control.name === "language"),
    ).toMatchObject({ kind: "text", value: "de" });
    expect(langs(markup(editor.getDocument(), set))).toEqual([
      "html=de",
      "body=de",
      "td=de",
    ]);
  });
});

/** Every element that writes a `dir`, as its tag and the way it runs. */
function dirs(html: string): string[] {
  return parseMarkup(html)
    .all("[dir]")
    .map((element) => `${element.localName}=${element.getAttribute("dir")}`);
}

// ADR-0027: the email runs one way, and alignment follows it.
describe("the email's direction", () => {
  it("writes rtl on html, body and the wrapper cell", () => {
    const html = markup(directed(lettered({}), "rtl"));

    expect(dirs(html)).toEqual(["html=rtl", "body=rtl", "td=rtl"]);
    // The CSS is a backup. The attribute is what counts.
    expect(styleOf(wrapper(html).cell)).toEqual({ direction: "rtl" });
  });

  it("writes ltr for a Document with no stored direction", () => {
    const html = markup(lettered({}));

    expect(dirs(html)).toEqual(["html=ltr", "body=ltr", "td=ltr"]);
    expect(html).toBe(markup(directed(lettered({}), "ltr")));
  });

  it.each(["RTL", "auto", "", 1, null])(
    "writes ltr for the junk direction %j",
    (direction) => {
      // Unchecked, because `null` is the wrong shape and an error stops the
      // render. A preview still renders it.
      expect(dirs(unchecked(directed(lettered({}), direction)))).toEqual([
        "html=ltr",
        "body=ltr",
        "td=ltr",
      ]);
    },
  );

  it("guesses nothing from the language", () => {
    expect(dirs(markup(lettered({ language: "ar" })))).toEqual([
      "html=ltr",
      "body=ltr",
      "td=ltr",
    ]);
  });

  it("never puts dir on a link", () => {
    const html = markup(
      directed(
        alone({
          id: "copy",
          type: "text",
          props: { content: '<a href="https://example.com">Go</a>' },
        }),
        "rtl",
      ),
    );

    expect(parseMarkup(html).all("a")).not.toEqual([]);
    expect(parseMarkup(html).all("a[dir]")).toEqual([]);
  });

  it("offers ltr and rtl on the root, with no Mobile Override", () => {
    const entry = definitions.find(
      (definition) => definition.type === REACT_EMAIL_ROOT_TYPE,
    )?.schema["direction"];

    expect(entry).toMatchObject({ label: "Direction", defaultValue: "ltr" });
    expect(valuesOf(entry?.constraints)).toEqual(["ltr", "rtl"]);
    expect(entry).not.toHaveProperty("mobile");
  });

  // #168: the stored values stay; the Author reads words.
  it("labels the two directions in words", () => {
    const entry = definitions.find(
      (definition) => definition.type === REACT_EMAIL_ROOT_TYPE,
    )?.schema["direction"];

    expect(entry?.constraints?.["options"]).toEqual([
      { label: "Left to right", value: "ltr" },
      { label: "Right to left", value: "rtl" },
    ]);
  });

  it("seeds a new Document with the Preset's direction", () => {
    const set = createReactEmailPreset({ direction: "rtl" });
    const editor = createEditor({
      definitions: set,
      rootType: REACT_EMAIL_ROOT_TYPE,
    });
    editor.select(editor.getDocument().root.id);

    expect(
      editor.getControls().find((control) => control.name === "direction"),
    ).toMatchObject({ value: "rtl" });
    expect(dirs(markup(editor.getDocument(), set))).toEqual([
      "html=rtl",
      "body=rtl",
      "td=rtl",
    ]);
  });
});

const LINEN = {
  src: "https://cdn.example.com/linen.png",
  width: 64,
  height: 64,
};
const paged = (rootProps: Record<string, unknown>): EmailDocument =>
  alone(
    { id: "copy", type: "text", props: { content: "On linen" } },
    rootProps,
  );

// #138: an image behind the whole email, tiled like wallpaper.
describe("the email's page background image", () => {
  // #175: wallpaper says nothing, so a picker asks no alt text for it.
  it("is decorative in the Image Request that sets it", () => {
    const editor = createEditor({
      definitions,
      rootType: REACT_EMAIL_ROOT_TYPE,
      document: paged({}),
      resolveImage: () => new Promise(() => {}),
    });
    const root = editor.getDocument().root.id;

    editor.replaceImage(root, "add", "backgroundImage");

    expect(editor.getImageRequests()).toMatchObject([
      {
        reason: "add",
        placement: {
          kind: "replace",
          blockId: root,
          prop: "backgroundImage",
          decorative: true,
        },
      },
    ]);
  });

  it("tiles the image on the body and on the cell everything sits in", () => {
    const html = markup(
      paged({ backgroundColor: "#eeeeee", backgroundImage: LINEN }),
    );
    const page = parseMarkup(html);

    for (const element of [page.one("body"), page.one(BODY_CELL)]) {
      expect(styleOf(element)).toMatchObject({
        "background-color": "#eeeeee",
        "background-image": 'url("https://cdn.example.com/linen.png")',
        "background-repeat": "repeat",
      });
    }
    expect(page.one("body").getAttribute("background")).toBe(
      "https://cdn.example.com/linen.png",
    );
  });

  it("tiles the same image for classic Outlook, first in the body, over the page color", () => {
    const html = markup(
      paged({ backgroundColor: "#eeeeee", backgroundImage: LINEN }),
    );

    expect(outlookMarkup(html).one("v\\:fill").outerHTML).toBe(
      '<v:fill type="tile" src="https://cdn.example.com/linen.png" color="#eeeeee"></v:fill>',
    );
    expect(html).toContain(
      '<body dir="ltr" background="https://cdn.example.com/linen.png" ' +
        'style="background-color:#eeeeee;' +
        "background-image:url(&quot;https://cdn.example.com/linen.png&quot;);" +
        'background-repeat:repeat"><div><!--[if mso]><v:background ' +
        'xmlns:v="urn:schemas-microsoft-com:vml" fill="t">',
    );
  });

  it("leaves the color off Outlook's tile when the page has none", () => {
    expect(
      markup(paged({ backgroundColor: NONE, backgroundImage: LINEN })),
    ).toContain(
      '<v:fill type="tile" src="https://cdn.example.com/linen.png"/>',
    );
  });

  it.each([
    ["a script URL", "javascript:alert(1)"],
    ["an HTML data URL", "data:text/html,<script>alert(1)</script>"],
  ])("draws no image from %s", (_, src) => {
    const html = markup(
      paged({ backgroundColor: "#eeeeee", backgroundImage: { ...LINEN, src } }),
    );

    expect(html).not.toContain("alert");
    expect(html).not.toContain("v:background");
    expect(html).toBe(markup(paged({ backgroundColor: "#eeeeee" })));
  });

  it("takes an image written into the email as data", () => {
    const src = "data:image/png;base64,iVBORw0KGgo=";

    expect(markup(paged({ backgroundImage: { ...LINEN, src } }))).toContain(
      `src="${src}"`,
    );
  });

  it("escapes a hostile URL in the CSS, the attribute and the VML", () => {
    const html = markup(
      paged({
        backgroundImage: {
          ...LINEN,
          src: `https://x.example/a"b'c<d>e(f).png`,
        },
      }),
    );

    expect(html).not.toContain('a"b');
    expect(html).not.toContain("c<d");
    expect(html).toContain(
      'src="https://x.example/a%22b%27c%3Cd%3Ee%28f%29.png"',
    );
  });

  it("warns when the page has no color to show with images off", () => {
    const warnings = (rootProps: Record<string, unknown>) =>
      createEditor({
        definitions,
        rootType: REACT_EMAIL_ROOT_TYPE,
        document: paged(rootProps),
      })
        .getDiagnostics()
        .filter((d) => d.code === PresetDiagnostic.backgroundImageColorMissing);

    expect(
      warnings({ backgroundColor: NONE, backgroundImage: LINEN }),
    ).toMatchObject([
      { blockId: "root", prop: "backgroundColor", severity: "warning" },
    ]);
    expect(
      warnings({ backgroundColor: NONE, backgroundImage: LINEN })[0],
    ).not.toHaveProperty("repair");
    expect(warnings({ backgroundImage: LINEN })).toEqual([]);
    expect(
      warnings({
        backgroundColor: NONE,
        backgroundImage: { ...LINEN, src: "javascript:alert(1)" },
      }),
    ).toEqual([]);
    expect(warnings({ backgroundColor: NONE })).toEqual([]);
  });
});
