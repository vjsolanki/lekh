import { fileURLToPath } from "node:url";
import { rolldown } from "rolldown";
import { describe, expect, it } from "vitest";

import {
  buttonBlock,
  columnsBlock,
  createCompliancePreset,
  createReactEmailPreset,
  dividerBlock,
  headingBlock,
  htmlBlock,
  iconRowBlock,
  imageBlock,
  navBlock,
  pickReactEmailPreset,
  REACT_EMAIL_ROOT_TYPE,
  type ReactEmailBlock,
  spacerBlock,
  textBlock,
} from "../blocks";

import {
  createEditor,
  describeBlocks,
  SchemaKind,
  type EmailDocument,
} from "../index";
import { parseMarkup, styleOf } from "../testing/markup";
import {
  definitions,
  labelsOf,
  markup,
  parsed,
  stylesOf,
  newsletter,
  alone,
  dividerAlone,
  cleared,
  unchecked,
} from "../testing/preset";

describe("the react.email Preset", () => {
  it("renders a Document to email-safe markup", () => {
    const html = markup(newsletter);

    expect(html).toContain("<h1");
    expect(html).toContain("Hello");
    expect(html).toContain("Some words.");
    expect(html).toContain('href="https://example.com"');
    // react.email lays out with tables, which is the whole point of using it.
    expect(html).toContain("<table");
  });

  it("carries the preview text a Consumer set on the root", () => {
    expect(markup(newsletter)).toContain("This week in email");
  });

  it("omits the preview when the root has none", () => {
    const bare: EmailDocument = {
      root: { id: "root", type: "email", props: {}, children: [] },
    };

    expect(markup(bare)).not.toContain("display:none");
  });

  it("gives each button a row of its own", () => {
    // react.email's Button is an inline-block anchor, so two of them left to
    // themselves share a line — and two Blocks on one line have one rectangle
    // between them, which is not something a drag can aim at: Drop Target
    // resolution decides before or after from a Block's vertical midpoint.
    const pair: EmailDocument = {
      root: {
        id: "root",
        type: REACT_EMAIL_ROOT_TYPE,
        props: {},
        children: [
          {
            id: "first",
            type: "button",
            props: { label: "One", href: "https://one.example" },
          },
          {
            id: "second",
            type: "button",
            props: { label: "Two", href: "https://two.example" },
          },
        ],
      },
    };

    const cells = parsed(pair)
      .all("a[href]")
      .map((button) => button.closest("td"));

    expect(cells).toHaveLength(2);
    expect(cells).not.toContain(null);
    expect(new Set(cells).size).toBe(2);
  });

  it("gives every Block a surface of its own", () => {
    // A background is not a container's privilege. A heading wants a highlight,
    // an image with transparency wants something to sit on, and neither should
    // mean wrapping the Block in a Section to get one. The html Block is the
    // exception: its markup is the only look it has (#75). So is the icon,
    // which sits on its row's (#78), and the nav link, on its nav's (#79).
    const without = definitions
      .filter(
        (definition) => !["html", "icon", "nav-link"].includes(definition.type),
      )
      .filter(
        (definition) => !Object.hasOwn(definition.schema, "backgroundColor"),
      )
      .map((definition) => definition.type);

    expect(without).toEqual([]);
  });

  it("emits no background at all until an Author picks a color", () => {
    // Every Definition, not a document typed out by hand. The rule is one that
    // every Block has to keep, and a hand-written document only checks the
    // Blocks whoever wrote it thought of — the button emitted
    // `background-color: none` for as long as this test listed three Blocks
    // and the button was not one of them.
    const emitting = definitions
      .filter((definition) => definition.type !== REACT_EMAIL_ROOT_TYPE)
      .filter((definition) =>
        markup(cleared(definition)).includes("background-color"),
      )
      .map((definition) => definition.type);

    expect(emitting).toEqual([]);
  });

  it("paints an Author's color behind the Block that carries it", () => {
    const highlighted: EmailDocument = {
      root: {
        id: "root",
        type: REACT_EMAIL_ROOT_TYPE,
        props: { backgroundColor: "none" },
        children: [
          {
            id: "title",
            type: "heading",
            props: { content: "Hello", backgroundColor: "#fff0f0" },
          },
        ],
      },
    };

    expect(markup(highlighted)).toContain("background-color:#fff0f0");
  });

  it("gives the divider a cell to paint, since a rule has no box of its own", () => {
    // An `<hr>` is a border and nothing else: its box is zero pixels tall, so a
    // colour put straight on it would be stored, resolved and invisible.
    const html = markup(dividerAlone({ backgroundColor: "#101010" }));

    expect(
      stylesOf(html, "td").map((style) => style["background-color"]),
    ).toContain("#101010");
    expect(styleOf(parseMarkup(html).one("hr"))).not.toHaveProperty(
      "background-color",
    );
  });

  it("is configurable where it must be, without a fork", () => {
    const branded = createReactEmailPreset({
      fontFamily: "Söhne, sans-serif",
      contentWidth: 720,
      backgroundColor: "#0b0b0b",
    });
    // With a Section in it, because the configured width is no longer emitted
    // by the root: every container paints edge to edge and centres its own
    // column, so the width appears wherever there is content to hold.
    const html = markup(
      {
        root: {
          id: "root",
          type: "email",
          props: {},
          children: [{ id: "band", type: "section", props: {}, children: [] }],
        },
      },
      branded,
    );

    expect(html).toContain("Söhne");
    expect(html).toContain("#0b0b0b");
    expect(html).toContain("720px");
  });

  it("drives an editor exactly like any other set of Block Definitions", () => {
    const editor = createEditor({
      definitions,
      rootType: REACT_EMAIL_ROOT_TYPE,
    });
    const root = editor.getDocument().root.id;
    const sectionId = editor.insertBlock("section", root) ?? "";
    const headingId = editor.insertBlock("heading", sectionId) ?? "";
    editor.select(headingId);

    expect(editor.getControls().map((control) => control.name)).toEqual([
      "content",
      "level",
      "fontSize",
      "lineHeight",
      "fontWeight",
      "letterSpacing",
      "color",
      "backgroundColor",
      "align",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "showOn",
    ]);
    expect(markup(editor.getDocument())).toContain("Your heading");
  });

  it("offers only the overridable props on the mobile Stage", () => {
    const editor = createEditor({
      definitions,
      rootType: REACT_EMAIL_ROOT_TYPE,
      stage: "mobile",
    });
    const root = editor.getDocument().root.id;
    editor.select(editor.insertBlock("heading", root) ?? "");

    // Font size, alignment and padding, which is what ADR-0007 allows an
    // override on. Colour and the heading level are absent: there is nothing
    // to emit.
    expect(editor.getControls().map((control) => control.name)).toEqual([
      "fontSize",
      "align",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
    ]);
  });

  it("stacks its columns on a phone without an Author lifting a finger", () => {
    const twoUp: EmailDocument = {
      root: {
        id: "root",
        type: REACT_EMAIL_ROOT_TYPE,
        props: {},
        children: [
          {
            id: "row",
            type: "columns",
            props: { reverseOnMobile: true },
            children: [
              {
                id: "left",
                type: "column",
                props: {},
                children: [
                  { id: "copy", type: "text", props: { content: "Words" } },
                ],
              },
              {
                id: "right",
                type: "column",
                props: {},
                children: [
                  { id: "aside", type: "text", props: { content: "More" } },
                ],
              },
            ],
          },
        ],
      },
    };
    const html = markup(twoUp);

    // Both classes land on the row, not on its columns: stacking and reversing
    // are decisions about the row's shape, and the rules reach through the
    // markup the row knows it emitted.
    expect(html).toContain('class="lekh-reverse lekh-stacked"');
    expect(html).toContain(".lekh-stacked>tbody>tr>td{display:inline-block");
    expect(html).toContain("@media only screen and (max-width:480px)");
  });

  it("stacks every column or none, never some of them", () => {
    // `lekh-stack` is element-local and would let one column stack while its
    // neighbour did not — a full-width block followed by a cell with no row
    // left to sit in. The switch is the row's so that state is unreachable.
    const column = definitions.find(
      (definition) => definition.type === "column",
    );

    expect(Object.keys(column?.schema ?? {})).not.toContain("stackOnMobile");
  });

  it("emits an Author's Mobile Overrides, forced, over the inline values", () => {
    const shrunk: EmailDocument = {
      root: {
        id: "root",
        type: REACT_EMAIL_ROOT_TYPE,
        props: {},
        children: [
          {
            id: "title",
            type: "heading",
            props: { fontSize: 40 },
            mobile: { fontSize: 24, align: "center" },
          },
        ],
      },
    };
    const html = markup(shrunk);

    expect(html).toContain("font-size:40px");
    expect(html).toContain(
      ".lekh-m-title{font-size:24px!important;text-align:center!important}",
    );
  });

  it("carries no mobile declarationssheet when the email needs none", () => {
    expect(markup(newsletter)).not.toContain("@media");
  });

  it("contributes its own Diagnostics", () => {
    const editor = createEditor({
      definitions,
      rootType: REACT_EMAIL_ROOT_TYPE,
    });
    const root = editor.getDocument().root.id;
    editor.insertBlock("image", root);
    editor.insertBlock("button", root);

    expect(
      editor.getDiagnostics().map(({ code, prop }) => ({ code, prop })),
    ).toEqual([
      { code: "image-alt-text-missing", prop: "asset" },
      { code: "button-href-missing", prop: "href" },
    ]);
  });

  it("counts whitespace and a non-string as saying nothing", () => {
    const editor = createEditor({
      definitions,
      rootType: REACT_EMAIL_ROOT_TYPE,
    });
    const root = editor.getDocument().root.id;
    editor.insertBlock("image", root, undefined, {
      asset: {
        src: "https://cdn.example.com/cat.jpg",
        width: 800,
        height: 600,
        alt: "   ",
      },
    });
    editor.insertBlock("button", root, undefined, { href: "   " });
    editor.insertBlock("button", root, undefined, { href: null });

    // `null` is the wrong shape for a link as well, which is its own error.
    expect(editor.getDiagnostics().map((finding) => finding.code)).toEqual([
      "prop-wrong-shape",
      "image-alt-text-missing",
      "button-href-missing",
      "button-href-missing",
    ]);
  });

  it("ships no Required Blocks — compliance content arrives with its own Preset", () => {
    expect(
      definitions.filter((definition) => definition.required === true),
    ).toEqual([]);
  });
});

describe("a link a Block holds", () => {
  const asset = { src: "https://example.com/a.png", width: 64, height: 64 };

  /** A button, an image, an icon and a nav link, every one linking to `href`. */
  const linkingTo = (href: string): EmailDocument =>
    alone({
      id: "row",
      type: "section",
      props: {},
      children: [
        { id: "cta", type: "button", props: { label: "Go", href } },
        { id: "photo", type: "image", props: { asset, href } },
        {
          id: "icons",
          type: "icon-row",
          props: {},
          children: [{ id: "icon", type: "icon", props: { asset, href } }],
        },
        {
          id: "nav",
          type: "nav",
          props: {},
          children: [
            { id: "link", type: "nav-link", props: { label: "Home", href } },
          ],
        },
      ],
    });

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "vbscript:msgbox(1)",
    "data:text/html,<script>alert(1)</script>",
  ])("never reaches the email when it could run script: %j", (href) => {
    const html = unchecked(linkingTo(href));

    expect(html.toLowerCase()).not.toContain("script:");
    expect(html.toLowerCase()).not.toContain("data:text");
    expect(html).toContain("Go");
    expect(html).toContain("Home");
  });

  it("reaches the email when it is one an email uses", () => {
    const html = unchecked(linkingTo("https://example.com/a?b=1&c=2"));

    expect(
      parseMarkup(html).all('[href="https://example.com/a?b=1&c=2"]'),
    ).toHaveLength(4);
    // Escaped as it is written out.
    expect(html).not.toContain("b=1&c=2");
  });
});

const typesOf = (blocks: readonly ReactEmailBlock[]) =>
  pickReactEmailPreset(blocks).map((definition) => definition.type);

describe("picking the Preset's Blocks", () => {
  it("registers only the listed Blocks, beside the email and the section", () => {
    expect(typesOf([textBlock, buttonBlock])).toEqual([
      "email",
      "section",
      "text",
      "button",
    ]);
  });

  it("brings each Structural Block with the Block that owns it", () => {
    expect(typesOf([columnsBlock, iconRowBlock, navBlock])).toEqual([
      "email",
      "section",
      "columns",
      "column",
      "icon-row",
      "icon",
      "nav",
      "nav-link",
    ]);
  });

  it("gives the email and the section alone for an empty list", () => {
    expect(typesOf([])).toEqual(["email", "section"]);
  });

  it("gives today's full Preset when every Block is listed", () => {
    const every = [
      columnsBlock,
      headingBlock,
      textBlock,
      imageBlock,
      buttonBlock,
      dividerBlock,
      spacerBlock,
      htmlBlock,
      iconRowBlock,
      navBlock,
    ];

    expect(typesOf(every)).toEqual(
      createReactEmailPreset().map((definition) => definition.type),
    );
  });

  it("passes the options on to the Blocks it builds", () => {
    const [root] = pickReactEmailPreset([textBlock], {
      fontFamily: "Georgia, serif",
    });

    expect(root?.schema["fontFamily"]?.defaultValue).toBe("Georgia, serif");
  });

  it("builds an editor that inserts only what it registered", () => {
    const editor = createEditor({
      definitions: pickReactEmailPreset([textBlock]),
      rootType: REACT_EMAIL_ROOT_TYPE,
    });
    const root = editor.getDocument().root.id;

    expect(editor.insertBlock("text", root)).toBeDefined();
    expect(editor.insertBlock("button", root)).toBeUndefined();
  });

  it("throws on a Block listed twice", () => {
    expect(() =>
      pickReactEmailPreset([textBlock, buttonBlock, textBlock]),
    ).toThrow('The Block "text" is listed twice.');
  });

  it("throws on a look-alike that is not one of its Blocks", () => {
    expect(() => pickReactEmailPreset([{ type: "text" }])).toThrow(
      '{"type":"text"} is not a Block from lekh-editor/blocks.',
    );
  });

  it.each([
    ["a type name", "text"],
    ["nothing", undefined],
  ])("throws on an entry that is not a Block at all: %s", (_, entry) => {
    expect(() =>
      pickReactEmailPreset([
        // A Consumer writing plain JavaScript can pass anything.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        entry as unknown as ReactEmailBlock,
      ]),
    ).toThrow(/is not a Block from lekh-editor\/blocks/u);
  });
});

// #168: the Preset's words are an Author's, spelt one way.
describe("the Preset's labels", () => {
  const shipped = [
    ...createReactEmailPreset(),
    ...createCompliancePreset({
      unsubscribeUrl: "https://esp.example/u",
      postalAddress: "1 Example Street",
    }),
  ];

  it("say color, never colour", () => {
    const words = shipped.flatMap((definition) =>
      Object.values(definition.schema).flatMap((entry) => [
        entry.label,
        entry.group ?? "",
        ...labelsOf(entry.constraints),
      ]),
    );

    expect(words.some((word) => /colou?r/iu.test(word))).toBe(true);
    expect(words.filter((word) => /colour/iu.test(word))).toEqual([]);
  });
});

const BRAND = [
  { label: "Orange", value: "#ff5a1f" },
  { label: "Ink", value: "#111111" },
];

describe("Brand Colours", () => {
  const branded = createReactEmailPreset({ colors: BRAND });

  it("carries them on every colour and Surface entry", () => {
    const colours = branded.flatMap((definition) =>
      Object.entries(definition.schema)
        .filter(
          ([, entry]) =>
            entry.kind === SchemaKind.color ||
            entry.kind === SchemaKind.surface,
        )
        .map(([name, entry]) => [`${definition.type}.${name}`, entry] as const),
    );

    expect(colours.length).toBeGreaterThan(10);
    for (const [name, entry] of colours) {
      expect(entry.constraints?.["brandColors"], name).toEqual(BRAND);
    }
  });

  it("hands them to an Inspector through the Control Descriptor", () => {
    const editor = createEditor({ definitions: branded, document: newsletter });
    editor.select("cta");
    const fill = editor
      .getControls()
      .find((control) => control.name === "backgroundColor");

    expect(fill?.constraints?.["brandColors"]).toEqual(BRAND);
  });

  it("adds nothing to any entry when the Consumer lists none", () => {
    for (const definition of createReactEmailPreset()) {
      for (const entry of Object.values(definition.schema)) {
        expect(entry.constraints ?? {}).not.toHaveProperty("brandColors");
      }
    }
  });

  it("stores the colour, not its name, and takes any other colour too", () => {
    const editor = createEditor({ definitions: branded, document: newsletter });
    editor.select("cta");
    const fill = () =>
      editor
        .getControls()
        .find((control) => control.name === "backgroundColor");
    const stored = () => editor.getBlock("cta")?.props["backgroundColor"];

    fill()?.set("#ff5a1f");
    expect(stored()).toBe("#ff5a1f");

    fill()?.set("#123456");
    expect(stored()).toBe("#123456");
  });

  it("tells an Agent about them on each colour prop", () => {
    const button = describeBlocks(branded).find(
      (description) => description.type === "button",
    );
    const description =
      button?.props.properties["backgroundColor"]?.["description"];

    expect(description).toContain("Orange #ff5a1f");
    expect(description).toContain("Ink #111111");
  });

  it("refuses a colour it could never write, by its label", () => {
    expect(() =>
      createReactEmailPreset({
        colors: [{ label: "Broken", value: "orange; x: y" }],
      }),
    ).toThrow(/Broken/u);
  });
});

/** The minified bundle of an app that picks `names`, comments and all gone. */
async function bundled(names: readonly string[]): Promise<string> {
  const entry = fileURLToPath(new URL("../blocks.tsx", import.meta.url));
  const app = "\0app";
  const bundle = await rolldown({
    input: app,
    platform: "neutral",
    logLevel: "silent",
    external: (id) => !id.startsWith(".") && !id.startsWith("/"),
    plugins: [
      {
        name: "app",
        resolveId: (id) => (id === app ? id : null),
        load: (id) =>
          id === app
            ? `import { pickReactEmailPreset, ${names.join(", ")} } from ${JSON.stringify(entry)};\n` +
              `export default pickReactEmailPreset([${names.join(", ")}]);`
            : null,
      },
    ],
  });
  const { output } = await bundle.generate({ format: "esm", minify: true });
  await bundle.close();
  return output
    .map((chunk) => (chunk.type === "chunk" ? chunk.code : ""))
    .join("\n");
}

/** A Block's label as the minified bundle writes it, in any quotes. */
const labelled = (label: string) =>
  new RegExp(`label:["'\`]${label}["'\`]`, "u");

describe("a bundle that picks a few Blocks", () => {
  it("leaves out the code of every Block it did not list", async () => {
    const code = await bundled(["textBlock"]);

    // Each Block's label is a string only its own file holds.
    expect(code).toMatch(labelled("Text"));
    for (const label of [
      "Heading",
      "Image",
      "Button",
      "Divider",
      "Spacer",
      "HTML",
      "Columns",
      "Icon row",
      "Navigation",
    ]) {
      expect(code).not.toMatch(labelled(label));
    }
  }, 30_000);
});
