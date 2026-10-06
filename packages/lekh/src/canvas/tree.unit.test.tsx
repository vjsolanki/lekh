import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createEditor,
  MOBILE_CLASSES,
  type Block,
  type EmailDocument,
  type Editor,
} from "../index";
import { createReactEmailPreset } from "../blocks";
import {
  definitions,
  definitionsResponsive,
  image,
  REVERSE_RULE,
} from "../testing/blocks";
import { editorFor } from "../testing/editor";
import {
  markupOf,
  markupOfNode,
  parseMarkup,
  styleOf,
  stylesheetOf,
} from "../testing/markup";
import { renderCanvasBlock } from "./tree";

/** The cache the Canvas keeps between passes. */
type RenderCache = NonNullable<Parameters<typeof renderCanvasBlock>[3]>;

/**
 * The Canvas's half of the Block-tree recursion (ADR-0006): what it adds over
 * the render path, at the seam rather than through a browser. The recursion
 * itself is in `core/render/render-tree.unit.test.tsx`.
 */

/** The Canvas marks every Block it renders; the render path has no reason to. */
const withoutBlockIds = (html: string) =>
  html.replaceAll(/ data-block-id="[^"]*"/gu, "");

const documentWith = (children: Block["children"]): Block => ({
  id: "root",
  type: "email",
  props: {},
  children,
});

describe("the Canvas tree", () => {
  it("draws the same markup the render path does", () => {
    // The two adapters differ only where ADR-0006 says they differ. Anything
    // else diverging is the bug this recursion exists to make impossible.
    const root = documentWith([
      {
        id: "row",
        type: "section",
        props: { padding: 24 },
        mobile: { padding: 8 },
        children: [
          {
            id: "copy",
            type: "text",
            props: { content: "Hello", fontSize: 32 },
            mobile: { fontSize: 18 },
          },
        ],
      },
    ]);

    expect(
      withoutBlockIds(
        markupOfNode(renderCanvasBlock(root, editorFor({ root }))),
      ),
    ).toBe(markupOf({ root }));
  });
});

/**
 * A Block an Author cannot hit is a Block they cannot edit, so the Canvas gives
 * one a box wherever a Block would otherwise have none.
 */
describe("a Block with nothing to show", () => {
  const emptySection: Block = {
    id: "row",
    type: "section",
    props: { padding: 16 },
    children: [],
  };

  const assetlessImage: Block = { id: "pic", type: "image", props: {} };

  it("gives an empty container a box on the Canvas", () => {
    const root = documentWith([emptySection]);

    expect(
      markupOfNode(renderCanvasBlock(root, editorFor({ root }))),
    ).toContain("min-height:40px");
  });

  it("stands in for a Block whose Definition rendered nothing", () => {
    // The test `image` renders null without an Asset, which is the state a
    // loaded Document can hold (ADR-0006) and the editor never creates.
    const root = documentWith([assetlessImage]);

    expect(
      markupOfNode(renderCanvasBlock(root, editorFor({ root }))),
    ).toContain('data-block-id="pic"');
  });

  it("marks the substitute with its Block's id, and the filler with none", () => {
    // The difference decides how a drag reads them. A substitute stands in for
    // the Block, so it has to be measurable in its place; a container's filler
    // must not be, or Drop Target resolution stops seeing the container as
    // empty and offers a position beside a child that is not there.
    const root = documentWith([emptySection, assetlessImage]);
    const html = markupOfNode(renderCanvasBlock(root, editorFor({ root })));

    expect(html).toContain(
      '<div data-block-stand-in="true" style="min-height:40px"></div>',
    );
    expect(html).toContain(
      '<div data-block-stand-in="true" style="min-height:40px" data-block-id="pic">',
    );
  });

  describe("a Definition with a stand-in of its own", () => {
    // An icon in a row of icons: a full-width box would break the row, so the
    // Definition says what room it takes when it has nothing to show.
    const shaped = {
      ...image,
      standIn: () => (
        <span style={{ display: "inline-block", width: 32, height: 32 }} />
      ),
    };
    const shapedDefinitions = definitions.map((definition) =>
      definition.type === "image" ? shaped : definition,
    );
    const root = documentWith([assetlessImage]);

    it("is the room it gets on the Canvas, marked as a stand-in", () => {
      const editor = editorFor({ root }, { definitions: shapedDefinitions });

      expect(markupOfNode(renderCanvasBlock(root, editor))).toContain(
        '<span style="display:inline-block;width:32px;height:32px" ' +
          'data-block-stand-in="true" data-block-id="pic"></span>',
      );
    });

    it("is not the filler an empty container gets", () => {
      const editor = editorFor(
        { root: documentWith([emptySection]) },
        { definitions: shapedDefinitions },
      );

      expect(
        markupOfNode(renderCanvasBlock(editor.getDocument().root, editor)),
      ).toContain('<div data-block-stand-in="true" style="min-height:40px">');
    });
  });

  it("leaves a leaf alone, however little it renders", () => {
    // `childrenOf` returns nothing for a leaf too. Only `accepts` tells a
    // container apart from a Block that was never going to hold anything.
    const root = documentWith([
      { id: "copy", type: "text", props: { content: "" } },
    ]);

    expect(
      markupOfNode(renderCanvasBlock(root, editorFor({ root }))),
    ).not.toContain("data-block-stand-in");
  });
});

/**
 * What the Canvas does with a cache, at the seam rather than through a browser.
 *
 * The browser suite counts renders, which is the outcome this exists for. This
 * is the mechanism underneath it: an unchanged Block comes back as the very
 * same node, which is what lets React skip the subtree without being told to.
 */
/** The Block an edit lands on, at whatever size the test wants it. */
const copyAt = (fontSize: number): Block => ({
  id: "copy",
  type: "text",
  props: { content: "Hello", fontSize },
});

/** Every Block's node, by id, from one pass through the cache. */
function drawn(root: Block, cache: RenderCache): Map<string, ReactNode> {
  // Dropped rather than read: every node, the root's included, is taken back
  // out of the cache below, which is the thing under test. `void` because
  // React 19 types a `ReactNode` as possibly a Promise, so discarding one
  // reads to the linter as a floating promise.
  void renderCanvasBlock(root, editorFor({ root }), undefined, cache);
  const nodes = new Map<string, ReactNode>();
  const visit = (block: Block): void => {
    const rendered = cache.get(block);
    if (rendered) nodes.set(block.id, rendered.node);
    block.children?.forEach(visit);
  };
  visit(root);
  return nodes;
}

describe("rendering through a cache", () => {
  const sibling: Block = {
    id: "sibling",
    type: "text",
    props: { content: "Beside it" },
  };

  const treeWith = (edited: Block): Block =>
    documentWith([
      {
        id: "section",
        type: "section",
        props: {},
        children: [edited, sibling],
      },
    ]);

  it("hands back the very same node for a Block that did not change", () => {
    const cache: RenderCache = new WeakMap();
    const editor = editorFor({ root: treeWith(copyAt(14)) });
    const first = drawn(editor.getDocument().root, cache);

    // The edit as the store makes it: a new Block, a new path down to it, and
    // every other Block left exactly as it was.
    editor.setProp("copy", "fontSize", 18);
    const second = drawn(editor.getDocument().root, cache);

    expect(second.get("sibling")).toBe(first.get("sibling"));
    expect(second.get("copy")).not.toBe(first.get("copy"));
    // The path down to the edit is new, because those Blocks are new objects.
    expect(second.get("section")).not.toBe(first.get("section"));
  });

  it("draws nothing differently for having a cache", () => {
    const root = treeWith(copyAt(14));

    expect(
      markupOfNode(
        renderCanvasBlock(root, editorFor({ root }), undefined, new WeakMap()),
      ),
    ).toBe(markupOfNode(renderCanvasBlock(root, editorFor({ root }))));
  });

  it("reuses a Block across two passes over a Document nothing touched", () => {
    const cache: RenderCache = new WeakMap();
    const root = treeWith(copyAt(14));

    expect(drawn(root, cache).get("copy")).toBe(drawn(root, cache).get("copy"));
  });
});

/** The rule that shows a mobile-only wrapper inside the media query. */
const REVEAL_RULE =
  `.lekh-mobile-only{display:block!important;max-height:none!important;` +
  `overflow:visible!important}`;

const STACK_RULE =
  `.${MOBILE_CLASSES.stack}{display:inline-block!important;width:100%!important;` +
  `max-width:100%!important;box-sizing:border-box!important}`;

describe("a Block shown only on a phone, on the Canvas", () => {
  // ADR-0025. What the email gets is in `responsive.test.tsx`.

  const teased = documentWith([
    {
      id: "teaser",
      type: "teaser",
      props: {},
      children: [
        { id: "copy", type: "text", props: {}, mobile: { fontSize: 18 } },
        {
          id: "row",
          type: "columns",
          props: {},
          children: [{ id: "cell", type: "column", props: {}, children: [] }],
        },
      ],
    },
  ]);

  it("is live on the Canvas: no comment, no string, and marked as its Block", () => {
    const editor = editorFor(
      { root: teased },
      { definitions: definitionsResponsive },
    );
    const html = markupOfNode(
      renderCanvasBlock(editor.getDocument().root, editor),
    );

    expect(html).not.toContain("[if !mso]");
    expect(html).toContain(
      `<div class="lekh-mobile-only" ` +
        `style="display:none;max-height:0;overflow:hidden" ` +
        `data-block-id="teaser"><div class="teaser">`,
    );
    expect(stylesheetOf(html)).toContain(REVEAL_RULE);
  });

  it("keeps its reveal rule when the Canvas reuses what it drew", () => {
    const editor = editorFor(
      {
        root: documentWith([
          ...(teased.children ?? []),
          { id: "other", type: "text", props: {} },
        ]),
      },
      { definitions: definitionsResponsive },
    );
    const cache: RenderCache = new WeakMap();
    const draw = () =>
      markupOfNode(
        renderCanvasBlock(editor.getDocument().root, editor, undefined, cache),
      );
    expect(stylesheetOf(draw())).toContain(REVEAL_RULE);

    editor.setProp("other", "fontSize", 20);

    expect(stylesheetOf(draw())).toContain(REVEAL_RULE);
  });
});

/**
 * The Canvas hands a Block back rather than rendering it again when nothing
 * about it changed. A Block's render is not only its markup — it is also
 * whatever that Block asked the stylesheet for on the way (ADR-0012) — so the
 * stylesheet is where a cache that forgot half the job would show.
 */
describe("a Canvas render that reuses what it drew before", () => {
  let editor: Editor;
  let cache: RenderCache;
  let copy: string;
  let reversible: string;

  beforeEach(() => {
    editor = editorFor(undefined, { definitions: definitionsResponsive });
    const root = editor.getDocument().root.id;

    // A marquee contributes a bespoke rule, and a column asks for a structural
    // one. Neither is touched by the edits below, so both are the rules a
    // forgetful cache would lose.
    editor.insertBlock("marquee", root);
    reversible = editor.insertBlock("columns", root) ?? "";
    const cell = editor.insertBlock("column", reversible) ?? "";
    copy = editor.insertBlock("text", cell) ?? "";

    cache = new WeakMap();
  });

  /** The email as the Canvas draws it, through the cache under test. */
  const draw = (): string =>
    markupOfNode(
      renderCanvasBlock(editor.getDocument().root, editor, undefined, cache),
    );

  it("keeps the rules of the Blocks it did not draw again", () => {
    const before = stylesheetOf(draw());
    // Both kinds are in there to begin with, or the rest proves nothing.
    expect(before).toContain(STACK_RULE);
    expect(before).toContain(".marquee>span");

    editor.setProp(copy, "fontSize", 18);

    expect(stylesheetOf(draw())).toBe(before);
  });

  it("picks up a rule the edit itself introduced", () => {
    expect(stylesheetOf(draw())).not.toContain(REVERSE_RULE);

    editor.setProp(reversible, "reverseOnMobile", true);

    expect(stylesheetOf(draw())).toContain(REVERSE_RULE);
  });

  it("draws the same email a Canvas with no cache would", () => {
    editor.setProp(copy, "fontSize", 18);
    const cached = draw();

    cache = new WeakMap();

    expect(draw()).toBe(cached);
  });
});

/** A container of one child type, each child holding the props given. */
const holding = (
  type: string,
  childType: string,
  children: readonly Record<string, unknown>[],
  props: Record<string, unknown> = {},
): Block => ({
  id: "subject",
  type,
  props,
  children: children.map((childProps, at) => ({
    id: `${childType === "icon" ? "icon" : "link"}-${String(at)}`,
    type: childType,
    props: childProps,
  })),
});

/** Every inline-block link, span or separator, in order. */
const inlineBlocks = (html: string): readonly Element[] =>
  parseMarkup(html)
    .all("a, span")
    .filter((element) => styleOf(element)["display"] === "inline-block");

/**
 * What the react.email Preset draws on the Canvas and nowhere else: no Outlook
 * markup, and a stand-in where the email would draw nothing.
 */
describe("the react.email Preset on the Canvas", () => {
  const preset = createReactEmailPreset();

  /** The Canvas's markup for one Block under a root that paints nothing. */
  const canvasOf = (subject: Block): string => {
    const document: EmailDocument = {
      root: {
        id: "root",
        type: "email",
        props: { backgroundColor: "none" },
        children: [subject],
      },
    };
    const editor = createEditor({ definitions: preset, document });
    return markupOfNode(renderCanvasBlock(editor.getDocument().root, editor));
  };

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
  const shopAbout = [
    { label: "Shop", href: "https://example.com/shop" },
    { label: "About", href: "https://example.com/about" },
  ];

  it("draws a content background image as CSS alone, with what it holds still editable", () => {
    const html = canvasOf({
      id: "subject",
      type: "section",
      props: {
        contentBackgroundImage: {
          src: "https://cdn.example.com/sky.jpg",
          width: 1200,
          height: 800,
        },
        contentBackgroundColor: "#123456",
      },
      children: [{ id: "copy", type: "text", props: { content: "Over" } }],
    });

    expect(html).not.toContain("[if mso]");
    expect(html).not.toContain("v:rect");
    expect(
      styleOf(parseMarkup(html).one("td[style*='background-image']"))[
        "background-size"
      ],
    ).toBe("cover");
    expect(parseMarkup(html).all('[data-block-id="copy"]')).toHaveLength(1);
  });

  it("gives an html Block that holds nothing its stand-in", () => {
    const html = canvasOf({ id: "subject", type: "html", props: {} });

    const standIn = parseMarkup(html).one('[data-block-stand-in="true"]');

    expect(standIn.localName).toBe("div");
    expect(standIn.matches('[data-block-id="subject"]')).toBe(true);
  });

  it("draws the same icons as the email, with no Outlook markup", () => {
    const html = canvasOf(
      holding("icon-row", "icon", [
        { asset: ON_X, href: "https://x.com/acme" },
        { asset: ON_INSTAGRAM, href: "https://instagram.com/acme" },
      ]),
    );

    expect(html).not.toContain("[if mso]");
    expect(parseMarkup(html).all("img")).toHaveLength(2);
  });

  it("gives an icon with no image a square at the icon size", () => {
    const html = canvasOf(
      holding("icon-row", "icon", [{}, { asset: ON_X }], { iconSize: 40 }),
    );
    const standIn = parseMarkup(html).one('span[data-block-stand-in="true"]');
    const square = standIn.firstElementChild;

    expect(standIn.matches('[data-block-id="icon-0"]')).toBe(true);
    expect(styleOf(standIn)["padding-right"]).toBe("12px");
    expect(square?.localName).toBe("span");
    expect(square && styleOf(square)).toMatchObject({
      width: "40px",
      height: "40px",
    });
  });

  it("spaces an icon from the empty ones after it", () => {
    // One listed icon seeds a row like this.
    const html = canvasOf(
      holding("icon-row", "icon", [{ asset: ON_X }, {}, {}]),
    );

    expect(
      inlineBlocks(html)
        .filter((element) => element.localName === "span")
        .map((span) => styleOf(span)["padding-right"]),
    ).toEqual(["12px", "12px", "0"]);
  });

  it("spaces a blank nav link from the last one that shows", () => {
    const html = canvasOf(
      holding("nav", "nav-link", [...shopAbout, { label: "" }]),
    );
    const standIn = parseMarkup(html).one('span[data-block-stand-in="true"]');

    expect(styleOf(standIn)).toMatchObject({
      "padding-left": "16px",
      "padding-right": "0",
    });
  });

  it("draws the same nav links as the email, with no Outlook markup", () => {
    const html = canvasOf(
      holding("nav", "nav-link", shopAbout, { separator: "|" }),
    );

    expect(html).not.toContain("[if mso]");
    expect(
      inlineBlocks(html).filter((item) => item.children.length === 0),
    ).toHaveLength(3);
  });

  it("gives a nav link with no label a faint placeholder", () => {
    const html = canvasOf(
      holding("nav", "nav-link", [{ label: "" }, shopAbout[0] ?? {}]),
    );
    const standIn = parseMarkup(html).one('span[data-block-stand-in="true"]');

    expect(standIn.matches('[data-block-id="link-0"]')).toBe(true);
    expect(styleOf(standIn)["padding-right"]).toBe("16px");
    expect(styleOf(standIn)).toHaveProperty("opacity");
    expect(standIn.children).toHaveLength(0);
    expect(standIn.textContent).toBe("Link");
  });
});
