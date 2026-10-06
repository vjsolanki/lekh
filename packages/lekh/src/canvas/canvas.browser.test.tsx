import { useEffect, useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  Canvas,
  EditorProvider,
  useBlockDrag,
  usePalette,
  usePaletteDrag,
} from "../canvas";
import type {
  BlockChromeProps,
  DiagnosticChromeProps,
  DropIndicatorProps,
  PendingImageProps,
  Rect,
} from "../canvas";
import {
  SchemaKind,
  createEditor,
  defineBlock,
  type Asset,
  type BlockDefinition,
  type Editor,
  type EmailDocument,
  type ImageRequest,
  type ImageResolver,
  type Validator,
} from "../index";
import { createReactEmailPreset, REACT_EMAIL_ROOT_TYPE } from "../blocks";
import { sequentialIds } from "../testing/blocks";
import {
  afterAFrame,
  blockElement,
  centreOf,
  centreOfBlock,
  drawnRectOf,
  doubleClickPointer,
  dragPointer,
  holdPointer,
  mount,
  movePointer,
  pathBetween,
  pointOnBlock,
  pressKey,
  releasePointer,
  whenRendered,
  type MountedCanvas,
} from "../testing/browser";
import { createTiptapTextEngine } from "../tiptap";

/**
 * The browser seam.
 *
 * Only what genuinely cannot be reached without a real layout engine: that the
 * Document lands inside the iframe, that a rectangle measured in there arrives
 * in a Slot already translated, that a real pointer drag changes the Document,
 * that a drag held at the edge scrolls the Canvas, that a keystroke inside the
 * frame reaches a Command, and that Chrome follows the Canvas when it scrolls
 * or resizes. Everything else about the editor is exercised without a DOM in
 * the Node suites.
 *
 * Assertions are on observable outcomes — the resulting Document, and where a
 * Slot's element actually ended up on screen — never on drag state.
 */

const BLOCK_HEIGHT = 60;

/**
 * Blocks with fixed heights and no table markup, so a drag can aim at a
 * specific half of a specific Block. The engine is what is under test here,
 * not a Preset's choice of elements.
 */
const definitions: readonly BlockDefinition[] = [
  defineBlock<{ background: string }>({
    type: "email",
    label: "Email",
    accepts: ["stack", "text", "image"],
    schema: {
      background: { kind: "color", label: "Background", defaultValue: "#fff" },
    },
    render: ({ props, children }) => (
      <div style={{ background: props.background }}>{children}</div>
    ),
  }),
  defineBlock<{ padding: number }>({
    type: "stack",
    label: "Stack",
    accepts: ["text"],
    schema: { padding: { kind: "number", label: "Padding", defaultValue: 8 } },
    render: ({ props, children }) => (
      <div style={{ padding: props.padding }}>{children}</div>
    ),
  }),
  defineBlock<{ content: string }>({
    type: "text",
    label: "Text",
    schema: {
      content: { kind: "text", label: "Content", defaultValue: "Text" },
    },
    render: ({ props }) => (
      <p
        style={{
          margin: 0,
          height: BLOCK_HEIGHT,
          lineHeight: `${BLOCK_HEIGHT}px`,
        }}
      >
        {props.content}
      </p>
    ),
  }),
  defineBlock<{ asset: Asset | undefined }>({
    type: "image",
    label: "Image",
    schema: {
      asset: {
        kind: SchemaKind.asset,
        label: "Image",
        defaultValue: undefined,
        primary: true,
      },
    },
    render: ({ props }) =>
      props.asset ? <img src={props.asset.src} alt="" /> : null,
  }),
];

/**
 * The order the Blocks of a parent are actually drawn in.
 *
 * Asserted alongside the Document, because the two can disagree. A Document
 * that reads correctly while the email on screen has not moved is the bug an
 * Author reports as "dragging does nothing", and it is invisible to a test
 * that only reads the Document — which is the half that was always right.
 */
function renderedOrder(
  mounted: MountedCanvas,
  parentId: string,
): readonly string[] {
  const parent = blockElement(mounted, parentId);
  return [...parent.querySelectorAll<HTMLElement>("[data-block-id]")].map(
    (element) => element.dataset.blockId ?? "",
  );
}

/**
 * The harness's host, made a scroller of the given height, the way a
 * Consumer's page puts the Canvas in one.
 */
function inAScroller(height: number): { readonly hostStyle: string } {
  return {
    hostStyle:
      "position:absolute; top:30px; left:50px; width:700px; " +
      `height:${String(height)}px; overflow-y:auto;`,
  };
}

function editorWith(
  contents: readonly string[],
  resolveImage?: ImageResolver,
): Editor {
  const editor = createEditor({
    definitions,
    rootType: "email",
    createId: sequentialIds("block"),
    ...(resolveImage ? { resolveImage } : {}),
  });
  const root = editor.getDocument().root.id;
  for (const content of contents) {
    editor.insertBlock("text", root, undefined, { content });
  }
  return editor;
}

const childContents = (editor: Editor): readonly unknown[] =>
  (editor.getDocument().root.children ?? []).map(
    (block) => block.props["content"],
  );

/** An email of Sections, each holding text Blocks: what an Author builds. */
function editorWithSections(sections: readonly (readonly string[])[]): Editor {
  const editor = createEditor({
    definitions,
    rootType: "email",
    createId: sequentialIds("block"),
  });
  const root = editor.getDocument().root.id;
  for (const contents of sections) {
    const section = editor.insertBlock("stack", root);
    if (section === undefined) throw new Error("The Section was refused.");
    for (const content of contents) {
      editor.insertBlock("text", section, undefined, { content });
    }
  }
  return editor;
}

const sectionContents = (editor: Editor): readonly (readonly unknown[])[] =>
  (editor.getDocument().root.children ?? []).map((section) =>
    (section.children ?? []).map((block) => block.props["content"]),
  );

/** The ids of the Blocks in the email's first Section, as the Document reads. */
const order = (editor: Editor): readonly string[] =>
  (editor.getDocument().root.children?.[0]?.children ?? []).map(
    (block) => block.id,
  );

/** The ids of a Section's Blocks, read afresh — a move rearranges them. */
function blocksInSection(editor: Editor, section: number): readonly string[] {
  const children =
    editor.getDocument().root.children?.[section]?.children ?? [];
  return children.map((block) => block.id);
}

describe("the Canvas", () => {
  it("renders the Document inside the iframe and nowhere else", async () => {
    const editor = editorWith(["Hello"]);
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas />
      </EditorProvider>,
    );
    const { frameDocument } = await whenRendered(host);

    expect(frameDocument.body.textContent).toContain("Hello");
    // Nothing of the email is in the Consumer's own document, so their CSS
    // cannot reach it.
    expect(host.textContent).not.toContain("Hello");
  });

  it("renders a Block whose markup is a whole email document", async () => {
    const wholeDocument: readonly BlockDefinition[] = [
      defineBlock<Record<string, never>>({
        type: "email",
        label: "Email",
        accepts: [],
        schema: {},
        render: () => (
          <html lang="en">
            <head>
              <title>Newsletter</title>
            </head>
            <body>
              <p>Whole document</p>
            </body>
          </html>
        ),
      }),
    ];
    const editor = createEditor({
      definitions: wholeDocument,
      rootType: "email",
      createId: sequentialIds("block"),
    });

    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas />
      </EditorProvider>,
    );
    const { frameDocument } = await whenRendered(host);

    expect(frameDocument.body.textContent).toContain("Whole document");
  });

  it("refuses to follow a link an Author clicks in the email", async () => {
    const withLink: readonly BlockDefinition[] = [
      defineBlock<Record<string, never>>({
        type: "email",
        label: "Email",
        accepts: [],
        schema: {},
        render: () => <a href="https://example.com/elsewhere">Read more</a>,
      }),
    ];
    const editor = createEditor({
      definitions: withLink,
      rootType: "email",
      createId: sequentialIds("block"),
    });

    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas />
      </EditorProvider>,
    );
    const { frameDocument } = await whenRendered(host);

    const anchor = frameDocument.querySelector("a");
    const view = frameDocument.defaultView;
    if (!anchor || !view) throw new Error("The link never rendered.");
    const click = new view.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    anchor.dispatchEvent(click);

    // An Author clicking a Button means "select this Block". Following the
    // link would replace the frame's document, and the portal the Canvas
    // renders through — the whole editing session — would go with it.
    expect(click.defaultPrevented).toBe(true);
  });
});

describe("a Slot's rectangle", () => {
  it("arrives translated into the Consumer's own coordinates", async () => {
    const editor = editorWith(["One", "Two"]);
    const target = editor.getDocument().root.children?.[1]?.id ?? "";

    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas
          // A border and padding make the Canvas element's box and the layer
          // Chrome is positioned against two different rectangles.
          style={{ border: "4px solid black", padding: 12 }}
          slots={{ selection: SelectionOutline }}
        />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    editor.select(target);

    const outline = await vi.waitFor(() => {
      const element = host.querySelector("[data-testid='selection']");
      if (!element) throw new Error("No selection Chrome yet.");
      return element;
    });

    // The only claim worth making: the Chrome the Consumer positioned from the
    // rectangle sits exactly over the Block, across a document boundary.
    await vi.waitFor(() => {
      const chrome = outline.getBoundingClientRect();
      const block = blockElement(mounted, target).getBoundingClientRect();
      const frame = mounted.frame.getBoundingClientRect();
      expect(chrome.left).toBeCloseTo(frame.left + block.left, 0);
      expect(chrome.top).toBeCloseTo(frame.top + block.top, 0);
      expect(chrome.width).toBeCloseTo(block.width, 0);
      expect(chrome.height).toBeCloseTo(block.height, 0);
    });
  });

  it("comes back over its Block once an animation moving it ends", async () => {
    const editor = editorWith(["One", "Two"]);
    const target = editor.getDocument().root.children?.[1]?.id ?? "";

    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas slots={{ selection: SelectionOutline }} />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    editor.select(target);
    const outline = await vi.waitFor(() => {
      const element = host.querySelector("[data-testid='selection']");
      if (!element) throw new Error("No selection Chrome yet.");
      return element;
    });

    // A Consumer slides the Block into place, and the Canvas measures while
    // it is still on its way: the pass lands where the slide started.
    const block = blockElement(mounted, target);
    const frame = mounted.frame.getBoundingClientRect();
    const restingTop = frame.top + block.getBoundingClientRect().top;
    const sliding = block.animate(
      [{ transform: "translateY(200px)" }, { transform: "translateY(200px)" }],
      { duration: 600 },
    );
    globalThis.dispatchEvent(new Event("resize"));
    await vi.waitFor(() => {
      expect(outline.getBoundingClientRect().top).toBeCloseTo(
        restingTop + 200,
        -1,
      );
    });

    await sliding.finished;
    await vi.waitFor(() => {
      expect(outline.getBoundingClientRect().top).toBeCloseTo(restingTop, 0);
    });
  });
});

describe("dragging", () => {
  it("inserts a Block dragged from the palette at the resolved position", async () => {
    const editor = editorWith(["One", "Two"]);
    const host = mount(
      <EditorProvider editor={editor}>
        <PaletteButton type="text" />
        <Canvas style={{ position: "absolute", top: 60, left: 0 }} />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const first = editor.getDocument().root.children?.[0]?.id ?? "";

    const handle = host.querySelector("[data-testid='palette-text']");
    if (!handle) throw new Error("The palette entry did not render.");

    // Released below the midpoint of the first Block, which resolves to an
    // insertion after it.
    await dragPointer(
      pathBetween(centreOf(handle), pointOnBlock(mounted, first, 0.8)),
    );

    // A Block an Author has just dropped stores nothing of its own, so its
    // content resolves to the Schema default rather than sitting in the
    // Document — which is what keeps stored Documents small.
    await vi.waitFor(() => {
      expect(childContents(editor)).toEqual(["One", undefined, "Two"]);
      const root = editor.getDocument().root;
      expect(renderedOrder(mounted, root.id)).toEqual(
        (root.children ?? []).map((block) => block.id),
      );
    });
  });

  it("moves an existing Block dragged to a new position", async () => {
    const editor = editorWith(["One", "Two"]);
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const children = editor.getDocument().root.children ?? [];
    const first = children[0]?.id ?? "";
    const second = children[1]?.id ?? "";
    const root = editor.getDocument().root.id;

    await dragPointer(
      pathBetween(
        centreOfBlock(mounted, second),
        pointOnBlock(mounted, first, 0.2),
      ),
    );

    await vi.waitFor(() => {
      expect(childContents(editor)).toEqual(["Two", "One"]);
      expect(renderedOrder(mounted, root)).toEqual([second, first]);
    });
  });

  /**
   * A Block that has moved once must still be draggable.
   *
   * This was the sharpest edge of the old design: a drag left a clone behind,
   * the drop re-registered every draggable while both copies were still in the
   * frame, and binding to the copy about to be discarded left the Block with no
   * draggable at all — the grab fell through to an ancestor and carried its
   * siblings along. There is one copy now, so it cannot happen that way. Pinned
   * because the symptom was so far from the cause.
   */
  it("moves a Block that has already been moved once", async () => {
    const editor = editorWith(["One", "Two", "Three"]);
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const children = editor.getDocument().root.children ?? [];
    const third = children[2]?.id ?? "";
    const second = children[1]?.id ?? "";
    const first = children[0]?.id ?? "";
    const root = editor.getDocument().root.id;

    await dragPointer(
      pathBetween(
        centreOfBlock(mounted, third),
        pointOnBlock(mounted, first, 0.2),
      ),
    );
    await vi.waitFor(() => {
      expect(childContents(editor)).toEqual(["Three", "One", "Two"]);
      expect(renderedOrder(mounted, root)).toEqual([third, first, second]);
    });

    // The same Block again, back down past the Block now above it. Measured
    // afresh, because everything has moved.
    const moved = await whenRendered(host);
    await dragPointer(
      pathBetween(centreOfBlock(moved, third), pointOnBlock(moved, first, 0.8)),
    );
    await vi.waitFor(() => {
      expect(childContents(editor)).toEqual(["One", "Three", "Two"]);
      expect(renderedOrder(moved, root)).toEqual([first, third, second]);
    });
  });
});

/**
 * What an Author actually does: an email is Sections, and the Blocks they
 * rearrange live inside one. Nesting is what made this the hardest case under
 * the old design — the clone left behind was a copy of the whole subtree, so
 * every Block inside it appeared twice under the same ids.
 */
describe("rearranging Blocks inside a Section", () => {
  /**
   * The direction that used to go wrong. React reorders siblings by moving the
   * ones that fell behind, so carrying a Block *down* past its neighbour was
   * the case where the element React moved was the one the backend then put
   * back where it was picked up.
   */
  it("moves a Block down within its Section, on screen and not only in the Document", async () => {
    const editor = editorWithSections([["One", "Two", "Three"]]);
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const section = editor.getDocument().root.children?.[0]?.id ?? "";
    // Read before the drag, so what the screen is checked against is the order
    // the test asked for rather than the order the Document ended up in.
    const [first, second, third] = blocksInSection(editor, 0);

    await dragPointer(
      pathBetween(
        centreOfBlock(mounted, first ?? ""),
        pointOnBlock(mounted, third ?? "", 0.8),
      ),
    );

    await vi.waitFor(() => {
      expect(sectionContents(editor)).toEqual([["Two", "Three", "One"]]);
      expect(renderedOrder(mounted, section)).toEqual([second, third, first]);
    });
  });

  it("moves a Block up within its Section", async () => {
    const editor = editorWithSections([["One", "Two", "Three"]]);
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const section = editor.getDocument().root.children?.[0]?.id ?? "";
    const [first, second, third] = blocksInSection(editor, 0);

    await dragPointer(
      pathBetween(
        centreOfBlock(mounted, third ?? ""),
        pointOnBlock(mounted, first ?? "", 0.2),
      ),
    );

    await vi.waitFor(() => {
      expect(sectionContents(editor)).toEqual([["Three", "One", "Two"]]);
      expect(renderedOrder(mounted, section)).toEqual([third, first, second]);
    });
  });

  it("moves the same Block a second time within its Section", async () => {
    const editor = editorWithSections([["One", "Two", "Three"]]);
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const section = editor.getDocument().root.children?.[0]?.id ?? "";
    const [first, second, third] = blocksInSection(editor, 0);

    await dragPointer(
      pathBetween(
        centreOfBlock(mounted, third ?? ""),
        pointOnBlock(mounted, first ?? "", 0.2),
      ),
    );
    await vi.waitFor(() => {
      expect(sectionContents(editor)).toEqual([["Three", "One", "Two"]]);
      expect(renderedOrder(mounted, section)).toEqual([third, first, second]);
    });

    // Everything has moved, so everything is measured again. The Author picks
    // up the Block they just dropped and puts it back down a place lower.
    const settled = await whenRendered(host);
    await dragPointer(
      pathBetween(
        centreOfBlock(settled, third ?? ""),
        pointOnBlock(settled, first ?? "", 0.8),
      ),
    );

    await vi.waitFor(() => {
      expect(sectionContents(editor)).toEqual([["One", "Three", "Two"]]);
      expect(renderedOrder(settled, section)).toEqual([first, third, second]);
    });
  });

  it("moves a different Block of the Section after one has been moved", async () => {
    const editor = editorWithSections([["One", "Two", "Three"]]);
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const section = editor.getDocument().root.children?.[0]?.id ?? "";
    const [first, second, third] = blocksInSection(editor, 0);

    await dragPointer(
      pathBetween(
        centreOfBlock(mounted, third ?? ""),
        pointOnBlock(mounted, first ?? "", 0.2),
      ),
    );
    await vi.waitFor(() => {
      expect(sectionContents(editor)).toEqual([["Three", "One", "Two"]]);
      expect(renderedOrder(mounted, section)).toEqual([third, first, second]);
    });

    // A neighbour of the Block that just moved.
    const settled = await whenRendered(host);
    await dragPointer(
      pathBetween(
        centreOfBlock(settled, second ?? ""),
        pointOnBlock(settled, third ?? "", 0.2),
      ),
    );

    // Only the Block that was grabbed moved. A grab that fell through to the
    // Section would have carried all three.
    await vi.waitFor(() => {
      expect(sectionContents(editor)).toEqual([["Two", "Three", "One"]]);
      expect(renderedOrder(settled, section)).toEqual([second, third, first]);
    });
  });

  it("moves a Block from one Section into another, twice", async () => {
    const editor = editorWithSections([
      ["One", "Two"],
      ["Three", "Four"],
    ]);
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const sections = (editor.getDocument().root.children ?? []).map(
      (section) => section.id,
    );
    const [, second] = blocksInSection(editor, 0);
    const [third, fourth] = blocksInSection(editor, 1);

    await dragPointer(
      pathBetween(
        centreOfBlock(mounted, second ?? ""),
        pointOnBlock(mounted, third ?? "", 0.2),
      ),
    );
    await vi.waitFor(() => {
      expect(sectionContents(editor)).toEqual([
        ["One"],
        ["Two", "Three", "Four"],
      ]);
      expect(renderedOrder(mounted, sections[1] ?? "")).toEqual([
        second,
        third,
        fourth,
      ]);
    });

    // And back again, which is the move an Author makes the moment they see
    // where it landed.
    const settled = await whenRendered(host);
    const [firstNow] = blocksInSection(editor, 0);
    await dragPointer(
      pathBetween(
        centreOfBlock(settled, second ?? ""),
        pointOnBlock(settled, firstNow ?? "", 0.8),
      ),
    );

    await vi.waitFor(() => {
      expect(sectionContents(editor)).toEqual([
        ["One", "Two"],
        ["Three", "Four"],
      ]);
      expect(renderedOrder(settled, sections[0] ?? "")).toEqual([
        firstNow,
        second,
      ]);
      expect(renderedOrder(settled, sections[1] ?? "")).toEqual([
        third,
        fourth,
      ]);
    });
  });
});

/**
 * The same rearranging, against the Blocks a Preset actually emits.
 *
 * The tests above use flat markup so a drag can aim at a known rectangle. Real
 * Block Definitions do not: a Section is a table, and a linked image is an
 * `<a>` around an `<img>` — so the element carrying the Block's id is a
 * different kind of thing from the one the pointer is over, and it is the kind
 * a browser focuses and drags on its own. This is the email in the
 * documentation, cut down to the two Blocks an Author moves past each other.
 */
/**
 * What the Canvas is measuring while a Block is in the air.
 *
 * The Block stays in the flow for the whole gesture now, so its rectangle says
 * where it sits throughout — and the drop resolves against measurements. This
 * used to be the trap: the Block was on screen twice, and measuring the copy
 * under the pointer made every Block resolve against a rectangle that was
 * chasing the cursor, so a Block dropped anywhere landed where it started.
 *
 * Asserted through the indicator, because that is the only part of it an
 * Author can see, and the only part a Consumer is handed. It needs a gesture
 * held open: at either end of a drag the question does not arise.
 */
describe("a drag still in the air", () => {
  it("draws the indicator where the Blocks sit, not where the pointer is", async () => {
    const editor = editorWithSections([["One", "Two", "Three"]]);
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas slots={{ dropIndicator: DropLine }} />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const [first, , third] = blocksInSection(editor, 0);

    // Held over the top of the first Block, with the last Block in hand.
    await holdPointer(
      pathBetween(
        centreOfBlock(mounted, third ?? ""),
        pointOnBlock(mounted, first ?? "", 0.2),
      ),
    );

    try {
      const indicator = await vi.waitFor(() => {
        const element = host.querySelector("[data-testid='drop-indicator']");
        if (!element) throw new Error("No drop indicator yet.");
        return element;
      });

      // The line sits on the first Block's top edge. Measured against the copy
      // under the pointer instead, the Block being carried would be the
      // deepest thing at the pointer, and the drop would resolve against
      // itself — landing exactly where it started.
      const target = blockElement(mounted, first ?? "").getBoundingClientRect();
      const frame = mounted.frame.getBoundingClientRect();
      expect(indicator.getBoundingClientRect().top).toBeCloseTo(
        frame.top + target.top,
        0,
      );
    } finally {
      await releasePointer();
    }

    await vi.waitFor(() => {
      expect(sectionContents(editor)).toEqual([["Three", "One", "Two"]]);
    });
  });
});

/** Where the drop indicator drew the container, once it has. */
async function parentBox(host: HTMLElement): Promise<DOMRect> {
  return vi.waitFor(() => {
    const element = host.querySelector("[data-testid='parent-box']");
    if (!element) throw new Error("No drop indicator yet.");
    return element.getBoundingClientRect();
  });
}

/**
 * The container a drop lands in, handed to the indicator beside the line, so a
 * Consumer can outline the level a Block is landing at.
 */
describe("the container a drop lands in", () => {
  function ParentBox({ parentRect }: DropIndicatorProps): ReactNode {
    return (
      <div
        data-testid="parent-box"
        style={{ position: "absolute", ...toStyle(parentRect) }}
      />
    );
  }

  async function heldOver(
    editor: Editor,
    from: string,
    to: string,
  ): Promise<{ readonly host: HTMLElement; readonly mounted: MountedCanvas }> {
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas slots={{ dropIndicator: ParentBox }} />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    await holdPointer(
      pathBetween(centreOfBlock(mounted, from), pointOnBlock(mounted, to, 0.2)),
    );
    return { host, mounted };
  }

  it("is the Section, for a drop between its Blocks", async () => {
    const editor = editorWithSections([["One", "Two", "Three"]]);
    const [first, , third] = blocksInSection(editor, 0);
    const section = editor.getDocument().root.children?.[0]?.id ?? "";
    const { host, mounted } = await heldOver(editor, third ?? "", first ?? "");
    try {
      const box = await parentBox(host);
      const expected = drawnRectOf(mounted, section);
      expect(box.top).toBeCloseTo(expected.top, 0);
      expect(box.left).toBeCloseTo(expected.left, 0);
      expect(box.width).toBeCloseTo(expected.width, 0);
      expect(box.height).toBeCloseTo(expected.height, 0);
    } finally {
      await releasePointer();
    }
  });

  it("is the email, for a drop at the top level", async () => {
    const editor = editorWith(["One", "Two", "Three"]);
    const [first, , third] = (editor.getDocument().root.children ?? []).map(
      (block) => block.id,
    );
    const root = editor.getDocument().root.id;
    const { host, mounted } = await heldOver(editor, third ?? "", first ?? "");
    try {
      const box = await parentBox(host);
      expect(box.height).toBeCloseTo(drawnRectOf(mounted, root).height, 0);
    } finally {
      await releasePointer();
    }
  });
});

/**
 * A container with nothing in it.
 *
 * Only reachable with a real layout engine, which is the whole difficulty: the
 * bug was that a container with no children has no box, and "no box" is a fact
 * about layout rather than about the Document. Everything asserted here is what
 * an Author would see — how tall the thing actually is, and where the Chrome
 * over it actually landed.
 */
describe("a container with nothing in it", () => {
  /** Stacks with no padding of their own, so any height is the Canvas's. */
  function editorWithEmptyStacks(count: number): Editor {
    const editor = createEditor({
      definitions,
      rootType: "email",
      createId: sequentialIds("block"),
    });
    const root = editor.getDocument().root.id;
    for (let index = 0; index < count; index++) {
      editor.insertBlock("stack", root, undefined, { padding: 0 });
    }
    return editor;
  }

  const EmptyMark = ({ block, rect }: BlockChromeProps): ReactNode => (
    <div
      data-testid="empty"
      data-block={block.id}
      style={{ position: "absolute", ...toStyle(rect) }}
    />
  );

  it("has a box an Author can actually hit", async () => {
    const editor = editorWithEmptyStacks(1);
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const stack = editor.getDocument().root.children?.[0]?.id ?? "";

    // Without the stand-in this is a zero-height div: nothing to hover, and
    // nothing for a Consumer to draw a drop indicator on.
    const box = blockElement(mounted, stack).getBoundingClientRect();
    expect(box.height).toBeGreaterThanOrEqual(40);
  });

  it("selects when an Author clicks it", async () => {
    const editor = editorWithEmptyStacks(1);
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const stack = editor.getDocument().root.children?.[0]?.id ?? "";

    // The symptom this exists to fix: an empty container the Author cannot
    // select is one whose props they cannot edit. Aimed at the filler rather
    // than at the container, because the filler is the only thing actually
    // under the pointer — the container's box is entirely made of it.
    const filler = blockElement(mounted, stack).firstElementChild;
    const view = mounted.frameDocument.defaultView;
    if (!filler || !view) throw new Error("The container has no box.");
    filler.dispatchEvent(
      new view.PointerEvent("pointerdown", { bubbles: true }),
    );

    await vi.waitFor(() => {
      expect(editor.getSelection()).toBe(stack);
    });
  });

  it("hands the Slot the container's own rectangle", async () => {
    const editor = editorWithEmptyStacks(1);
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas slots={{ emptyBlock: EmptyMark }} />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const stack = editor.getDocument().root.children?.[0]?.id ?? "";

    await vi.waitFor(() => {
      const [mark] = emptyMarks(host);
      if (!mark) throw new Error("No empty-container Chrome yet.");
      const drawn = mark.getBoundingClientRect();
      const box = blockElement(mounted, stack).getBoundingClientRect();
      const frame = mounted.frame.getBoundingClientRect();
      expect(drawn.top).toBeCloseTo(frame.top + box.top, 0);
      expect(drawn.height).toBeCloseTo(box.height, 0);
    });
  });

  it("stands down only on the container a drag is landing inside", async () => {
    // Two empty Stacks and something to carry. The one under the pointer hands
    // over to `dropIndicator`, which is drawing on the identical rectangle; the
    // other keeps advertising itself, because it is still somewhere the Block
    // could go.
    const editor = editorWithEmptyStacks(2);
    const root = editor.getDocument().root.id;
    editor.insertBlock("text", root, undefined, { content: "Carried" });

    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas slots={{ emptyBlock: EmptyMark }} />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const children = editor.getDocument().root.children ?? [];
    const [first, second, carried] = children.map((block) => block.id);

    await vi.waitFor(() => {
      expect(emptyMarks(host)).toHaveLength(2);
    });

    await holdPointer(
      pathBetween(
        centreOfBlock(mounted, carried ?? ""),
        centreOfBlock(mounted, first ?? ""),
      ),
    );

    try {
      await vi.waitFor(() => {
        const remaining = emptyMarks(host).map((mark) => mark.dataset["block"]);
        expect(remaining).toEqual([second]);
      });
    } finally {
      await releasePointer();
    }
  });
});

/** Flags every text Block that says "Bad", and the email as a whole. */
const flagBad: Validator = (document) => [
  { code: "email-wide", message: "About the email.", severity: "warning" },
  ...(document.root.children ?? [])
    .filter((child) => child.props["content"] === "Bad")
    .flatMap((child) => [
      {
        code: "bad-text",
        message: "This says Bad.",
        severity: "warning" as const,
        blockId: child.id,
        prop: "content",
      },
      {
        code: "still-bad",
        message: "It still says Bad.",
        severity: "error" as const,
        blockId: child.id,
      },
    ]),
];

const DiagnosticMark = ({
  block,
  rect,
  diagnostics,
}: DiagnosticChromeProps): ReactNode => (
  <div
    data-testid="diagnostic"
    data-block={block.id}
    data-codes={diagnostics.map((finding) => finding.code).join(" ")}
    style={{ position: "absolute", ...toStyle(rect) }}
  />
);

const diagnosticMarks = (host: HTMLElement): HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>('[data-testid="diagnostic"]'),
];

describe("a Block a Diagnostic names", () => {
  it("gets one mark, at its own rectangle, carrying its Diagnostics", async () => {
    const editor = createEditor({
      definitions,
      rootType: "email",
      createId: sequentialIds("block"),
      validators: [flagBad],
    });
    const root = editor.getDocument().root.id;
    editor.insertBlock("text", root, undefined, { content: "Good" });
    const bad =
      editor.insertBlock("text", root, undefined, { content: "Bad" }) ?? "";

    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas slots={{ diagnostic: DiagnosticMark }} />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);

    await vi.waitFor(() => {
      // The email-wide finding has no Block to sit on, and the good Block
      // has nothing to say.
      const marks = diagnosticMarks(host);
      expect(marks.map((mark) => mark.dataset["block"])).toEqual([bad]);
      expect(marks[0]?.dataset["codes"]).toBe("bad-text still-bad");

      const drawn = marks[0]?.getBoundingClientRect();
      const box = blockElement(mounted, bad).getBoundingClientRect();
      const frame = mounted.frame.getBoundingClientRect();
      expect(drawn?.top).toBeCloseTo(frame.top + box.top, 0);
      expect(drawn?.height).toBeCloseTo(box.height, 0);
    });

    editor.setProp(bad, "content", "Fine");
    await vi.waitFor(() => {
      expect(diagnosticMarks(host)).toEqual([]);
    });
  });
});

/**
 * The Block under the pointer, which is the one thing the library still draws.
 *
 * It draws it outside the frame, and that is the whole point: an ordinary
 * stylesheet reaches it, so a Consumer replaces it with a component rather than
 * fighting a rule they cannot see (ADR-0008). Everything asserted here is
 * observable — which document the preview landed in, what the frame does *not*
 * contain, and where the thing under the pointer actually is.
 */
/** A preview drawn with its corner where the Slot is placed. */
function PreviewAtPointer(): ReactNode {
  return <span data-testid="at-pointer">carried</span>;
}

describe("a Block being carried", () => {
  it("previews outside the frame and leaves the Block itself in the flow", async () => {
    const editor = editorWithSections([["One", "Two", "Three"]]);
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas
          slots={{ dropIndicator: DropLine, dragPreview: PreviewAtPointer }}
        />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const [first, , third] = blocksInSection(editor, 0);

    const from = centreOfBlock(mounted, third ?? "");
    const to = pointOnBlock(mounted, first ?? "", 0.2);
    await holdPointer(pathBetween(from, to));

    try {
      // Drawn in the Consumer's own document, where their CSS can reach it.
      const overlay = await vi.waitFor(() => {
        const element = window.document.querySelector("[data-dnd-overlay]");
        if (!element) throw new Error("No preview yet.");
        return element;
      });
      expect(overlay.ownerDocument).toBe(window.document);

      // And nothing was cloned into the email to stand in for the Block. The
      // Block is still its own single element, still where it was.
      expect(
        mounted.frameDocument.querySelectorAll("[data-dnd-placeholder]"),
      ).toHaveLength(0);
      expect(
        mounted.frameDocument.querySelectorAll(`[data-block-id="${third}"]`),
      ).toHaveLength(1);

      // The preview's corner sits on the pointer (ADR-0044): the assertion
      // that fails if the frame's offset is not applied to it.
      const preview = await vi.waitFor(() => {
        const element = window.document.querySelector(
          "[data-testid='at-pointer']",
        );
        if (!element) throw new Error("No preview yet.");
        return element.getBoundingClientRect();
      });
      expect(preview.left).toBeCloseTo(to.x, -1);
      expect(preview.top).toBeCloseTo(to.y, -1);

      // Drop resolution still lands, with the Block never leaving the flow.
      expect(
        window.document.querySelector("[data-testid='drop-indicator']"),
      ).not.toBeNull();
    } finally {
      await releasePointer();
    }

    await vi.waitFor(() => {
      expect(sectionContents(editor)).toEqual([["Three", "One", "Two"]]);
    });
  });

  it("draws a Consumer's own preview instead of the default", async () => {
    const editor = editorWithSections([["One", "Two", "Three"]]);
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas
          slots={{
            dragPreview: ({ block }) => (
              <div data-testid="my-preview">{block.type}</div>
            ),
          }}
        />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const [first, , third] = blocksInSection(editor, 0);

    await holdPointer(
      pathBetween(
        centreOfBlock(mounted, third ?? ""),
        pointOnBlock(mounted, first ?? "", 0.2),
      ),
    );
    try {
      const mine = await vi.waitFor(() => {
        const element = window.document.querySelector(
          "[data-testid='my-preview']",
        );
        if (!element) throw new Error("No preview yet.");
        return element;
      });
      expect(mine.textContent).toBe("text");
    } finally {
      await releasePointer();
    }
  });

  it("offers the Block it is leaving to a Slot, where it still sits", async () => {
    const editor = editorWithSections([["One", "Two", "Three"]]);
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas
          slots={{
            draggingBlock: ({ rect }) => (
              <div
                data-testid="ghost"
                style={{ position: "absolute", ...toStyle(rect) }}
              />
            ),
          }}
        />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const [first, , third] = blocksInSection(editor, 0);

    await holdPointer(
      pathBetween(
        centreOfBlock(mounted, third ?? ""),
        pointOnBlock(mounted, first ?? "", 0.2),
      ),
    );
    try {
      const ghost = await vi.waitFor(() => {
        const element = window.document.querySelector("[data-testid='ghost']");
        if (!element) throw new Error("No ghost yet.");
        return element;
      });
      // Over the Block where it still sits, not over the pointer.
      const stillThere = blockElement(mounted, third ?? "");
      const frame = mounted.frame.getBoundingClientRect();
      expect(ghost.getBoundingClientRect().top).toBeCloseTo(
        frame.top + stillThere.getBoundingClientRect().top,
        0,
      );
    } finally {
      await releasePointer();
    }
  });

  it("leaves a palette drag lifting the Consumer's own entry", async () => {
    const editor = editorWith(["One", "Two"]);
    const host = mount(
      <EditorProvider editor={editor}>
        <PaletteButton type="text" />
        <Canvas style={{ position: "absolute", top: 60, left: 0 }} />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const first = editor.getDocument().root.children?.[0]?.id ?? "";
    const handle = host.querySelector("[data-testid='palette-text']");
    if (!handle) throw new Error("The palette entry did not render.");

    await holdPointer(
      pathBetween(centreOf(handle), pointOnBlock(mounted, first, 0.8)),
    );
    try {
      // The Consumer's own button is what lifts — already their markup,
      // already wearing their styles, so a preview would only take away.
      await vi.waitFor(() => {
        const lifted = window.document.querySelector<HTMLElement>(
          "[data-dnd-dragging]",
        );
        expect(lifted?.dataset["testid"]).toBe("palette-text");
      });
    } finally {
      await releasePointer();
    }

    await vi.waitFor(() => {
      expect(childContents(editor)).toEqual(["One", undefined, "Two"]);
    });
  });
});

describe("rearranging a Section of a Preset's email", () => {
  const PICTURE = {
    // Drawn rather than fetched, so the Block has its size from the first
    // layout and a drop does not aim at an image that has not loaded.
    src:
      "data:image/svg+xml;utf8," +
      encodeURIComponent(
        "<svg xmlns='http://www.w3.org/2000/svg' width='240' height='140'>" +
          "<rect width='240' height='140' fill='%23336699'/></svg>",
      ),
    width: 240,
    height: 140,
    alt: "A picture",
  };

  /** A Section holding a linked image, a heading and a paragraph. */
  const startingDocument: EmailDocument = {
    root: {
      id: "root",
      type: REACT_EMAIL_ROOT_TYPE,
      props: { backgroundColor: "#eceef3", contentWidth: 600 },
      children: [
        {
          id: "section",
          type: "section",
          props: { backgroundColor: "#ffffff", paddingY: 16, paddingX: 24 },
          children: [
            {
              id: "picture",
              type: "image",
              props: {
                asset: PICTURE,
                width: 240,
                // Linked, which is what wraps it in an anchor — the element a
                // browser will happily focus and drag by itself, and the one
                // dnd-kit would refuse to start a drag from, left to itself.
                href: "https://example.com/story",
              },
            },
            {
              id: "headline",
              type: "heading",
              props: { content: "One timeline", level: 2, fontSize: 21 },
            },
            {
              id: "paragraph",
              type: "text",
              props: {
                content: "Type a word, drag a Block, undo.",
                fontSize: 15,
              },
            },
          ],
        },
      ],
    },
  };

  function presetEditor(): Editor {
    return createEditor({
      definitions: createReactEmailPreset({ contentWidth: 600 }),
      rootType: REACT_EMAIL_ROOT_TYPE,
      document: startingDocument,
      createId: sequentialIds("added"),
    });
  }

  it("moves the image down past the heading, and then back up", async () => {
    const editor = presetEditor();
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);

    // The Author drops the image below the heading's midpoint.
    await dragPointer(
      pathBetween(
        centreOfBlock(mounted, "picture"),
        pointOnBlock(mounted, "headline", 0.8),
      ),
    );
    await vi.waitFor(() => {
      expect(order(editor)).toEqual(["headline", "picture", "paragraph"]);
      expect(renderedOrder(mounted, "section")).toEqual([
        "headline",
        "picture",
        "paragraph",
      ]);
    });

    // And picks the same image up again — the drag that used to stop working,
    // when the Block's draggable had been bound to a clone the previous drop
    // threw away.
    const moved = await whenRendered(host);
    await dragPointer(
      pathBetween(
        centreOfBlock(moved, "picture"),
        pointOnBlock(moved, "headline", 0.2),
      ),
    );
    await vi.waitFor(() => {
      expect(order(editor)).toEqual(["picture", "headline", "paragraph"]);
      expect(renderedOrder(moved, "section")).toEqual([
        "picture",
        "headline",
        "paragraph",
      ]);
    });
  });

  it("moves the text after the image has been moved, and takes only the text", async () => {
    const editor = presetEditor();
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);

    await dragPointer(
      pathBetween(
        centreOfBlock(mounted, "picture"),
        pointOnBlock(mounted, "headline", 0.8),
      ),
    );
    await vi.waitFor(() => {
      expect(order(editor)).toEqual(["headline", "picture", "paragraph"]);
    });

    // A different Block of the same Section.
    const moved = await whenRendered(host);
    await dragPointer(
      pathBetween(
        centreOfBlock(moved, "paragraph"),
        pointOnBlock(moved, "headline", 0.2),
      ),
    );

    // Only the paragraph moved. A grab that fell through to the Section would
    // have carried the image and the heading with it, and a Section dropped
    // into itself would have changed nothing at all.
    await vi.waitFor(() => {
      expect(order(editor)).toEqual(["paragraph", "headline", "picture"]);
      expect(renderedOrder(moved, "section")).toEqual([
        "paragraph",
        "headline",
        "picture",
      ]);
    });
  });
});

/**
 * The same rearranging again, with the Text Engine mounted.
 *
 * This is the editor as the documentation ships it, and the difference is not
 * cosmetic: a Block with rich text has an editable surface of its own inside
 * it, and an Author grabbing that Block grabs the surface — never the element
 * the Block's id is on. A drag that only works when the pointer misses the
 * text is a drag that does not work.
 */
describe("rearranging text Blocks an Author can type into", () => {
  it("moves a Block down, on screen and not only in the Document", async () => {
    const { editor, mounted } = await mountTyped();

    await dragPointer(
      pathBetween(
        centreOfBlock(mounted, "headline"),
        pointOnBlock(mounted, "paragraph", 0.8),
      ),
    );

    await vi.waitFor(() => {
      expect(order(editor)).toEqual(["paragraph", "headline"]);
      // The assertion that matters. The Document above can read correctly
      // while the email an Author is looking at has not moved at all.
      expect(renderedOrder(mounted, "section")).toEqual([
        "paragraph",
        "headline",
      ]);
    });
  });

  it("moves a Block up, on screen and not only in the Document", async () => {
    const { editor, mounted } = await mountTyped();

    await dragPointer(
      pathBetween(
        centreOfBlock(mounted, "paragraph"),
        pointOnBlock(mounted, "headline", 0.2),
      ),
    );

    await vi.waitFor(() => {
      expect(order(editor)).toEqual(["paragraph", "headline"]);
      expect(renderedOrder(mounted, "section")).toEqual([
        "paragraph",
        "headline",
      ]);
    });
  });

  it("moves the same Block down and then back up", async () => {
    const { host, editor, mounted } = await mountTyped();

    await dragPointer(
      pathBetween(
        centreOfBlock(mounted, "headline"),
        pointOnBlock(mounted, "paragraph", 0.8),
      ),
    );
    await vi.waitFor(() => {
      expect(renderedOrder(mounted, "section")).toEqual([
        "paragraph",
        "headline",
      ]);
    });

    const moved = await whenRendered(host);
    await dragPointer(
      pathBetween(
        centreOfBlock(moved, "headline"),
        pointOnBlock(moved, "paragraph", 0.2),
      ),
    );
    await vi.waitFor(() => {
      expect(order(editor)).toEqual(["headline", "paragraph"]);
      expect(renderedOrder(moved, "section")).toEqual([
        "headline",
        "paragraph",
      ]);
    });
  });

  /**
   * The trade the double-click makes.
   *
   * A drag and a text selection are the same gesture — press, move, release —
   * so the same Block cannot offer both at once. Every test above proves the
   * drag half; these two prove that asking for the words gives it up, and that
   * Escape takes it back.
   */
  it("stops moving the Block once the Author is in its words", async () => {
    const { editor, mounted } = await mountTyped();

    await doubleClickPointer(centreOfBlock(mounted, "paragraph"));
    await vi.waitFor(() => {
      expect(editor.getEditing()).toBe("paragraph");
    });

    // The gesture that moved this Block a moment ago. It now selects words.
    await dragPointer(
      pathBetween(
        centreOfBlock(mounted, "paragraph"),
        pointOnBlock(mounted, "headline", 0.2),
      ),
    );
    await afterAFrame();

    expect(order(editor)).toEqual(["headline", "paragraph"]);
    expect(renderedOrder(mounted, "section")).toEqual([
      "headline",
      "paragraph",
    ]);
  });

  it("gives the Block back to the drag when the Author presses Escape", async () => {
    const { editor, mounted } = await mountTyped();

    await doubleClickPointer(centreOfBlock(mounted, "paragraph"));
    await vi.waitFor(() => {
      expect(editor.getEditing()).toBe("paragraph");
    });

    press(mounted.frameDocument, "Escape");
    await vi.waitFor(() => {
      expect(editor.getEditing()).toBeUndefined();
      // The selection stays: an Author who has finished the sentence has not
      // finished with the Block.
      expect(editor.getSelection()).toBe("paragraph");
    });

    await dragPointer(
      pathBetween(
        centreOfBlock(mounted, "paragraph"),
        pointOnBlock(mounted, "headline", 0.2),
      ),
    );
    await vi.waitFor(() => {
      expect(order(editor)).toEqual(["paragraph", "headline"]);
      expect(renderedOrder(mounted, "section")).toEqual([
        "paragraph",
        "headline",
      ]);
    });
  });

  // ADR-0032: Escape backs out of the newest thing first, and a drag the
  // Author has not let go of is newer than the sentence they were in.
  it("cancels a Pending Change on Escape before it stops the text", async () => {
    const { editor, mounted } = await mountTyped();

    await doubleClickPointer(centreOfBlock(mounted, "paragraph"));
    await vi.waitFor(() => {
      expect(editor.getEditing()).toBe("paragraph");
    });
    expect(editor.setPendingChange("paragraph", { fontSize: 30 })).toBe(true);

    press(mounted.frameDocument, "Escape");
    expect(editor.getPendingChange()).toBeUndefined();
    expect(editor.getBlock("paragraph")?.props["fontSize"]).toBe(15);
    expect(editor.canUndo()).toBe(false);
    expect(editor.getEditing()).toBe("paragraph");

    press(mounted.frameDocument, "Escape");
    expect(editor.getEditing()).toBeUndefined();
    expect(editor.getSelection()).toBe("paragraph");
  });

  it("leaves a Pending Change alone on an Escape outside the Canvas", async () => {
    const { host, editor } = await mountTyped();
    // A Consumer's own field, in their page beside the Canvas.
    const field = window.document.createElement("input");
    host.append(field);
    field.focus();
    expect(editor.setPendingChange("paragraph", { fontSize: 30 })).toBe(true);

    press(window.document, "Escape");
    expect(editor.getPendingChange()?.blockId).toBe("paragraph");
  });

  it("leaves a Block with no text where it is when it is double-clicked", async () => {
    const { editor, mounted } = await mountTyped();

    // The section holds both Blocks and has nothing to type into. Aimed at its
    // padding, which is the only part of it not covered by a child.
    const section = blockElement(mounted, "section").getBoundingClientRect();
    const frame = mounted.frame.getBoundingClientRect();
    await doubleClickPointer({
      x: frame.left + section.left + 4,
      y: frame.top + section.top + section.height / 2,
    });

    await afterAFrame();
    expect(editor.getEditing()).toBeUndefined();
  });
});

describe("an image arriving from outside the editor", () => {
  it("is asked for when a file is dropped onto the Canvas", async () => {
    const { resolve, asked } = recordingResolver();
    const editor = editorWith(["One", "Two"], resolve);
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas slots={{ pendingImage: PendingPlaceholder }} />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const first = editor.getDocument().root.children?.[0]?.id ?? "";
    const before = editor.getDocument();

    const dropped = fileIn(mounted, "cat.png");
    dispatchInFrame(
      mounted,
      first,
      0.8,
      (view, transfer, point) =>
        new view.DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
          ...point,
        }),
      dropped,
    );

    expect(asked).toHaveLength(1);
    expect(asked[0]?.reason).toBe("drop");
    expect(asked[0]?.files).toEqual([dropped]);
    // Released below the midpoint of the first Block, so the image is going
    // after it — and until it arrives, nothing is in the Document.
    expect(asked[0]?.placement).toMatchObject({
      kind: "insert",
      type: "image",
      target: { parentId: editor.getDocument().root.id, index: 1 },
    });
    expect(editor.getDocument()).toBe(before);

    // The Author sees something while they wait, drawn where the image is
    // going — over the boundary between the two Blocks it will land between.
    const placeholder = await vi.waitFor(() => {
      const element = host.querySelector("[data-testid='pending-image']");
      if (!element) throw new Error("No pending Chrome yet.");
      return element;
    });
    const boundary = blockElement(mounted, first).getBoundingClientRect();
    expect(placeholder.getBoundingClientRect().top).toBeCloseTo(
      mounted.frame.getBoundingClientRect().top + boundary.bottom,
      0,
    );
  });

  it("is asked for when an image is pasted into the Canvas", async () => {
    const { resolve, asked } = recordingResolver();
    const editor = editorWith(["One", "Two"], resolve);
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const second = editor.getDocument().root.children?.[1]?.id ?? "";
    editor.select(second);
    const before = editor.getDocument();

    const pasted = fileIn(mounted, "screenshot.png");
    dispatchInFrame(
      mounted,
      second,
      0.5,
      (view, transfer) =>
        new view.ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer,
        }),
      pasted,
    );

    expect(asked).toHaveLength(1);
    expect(asked[0]?.reason).toBe("paste");
    expect(asked[0]?.files).toEqual([pasted]);
    // A screenshot lands after the Block the Author was looking at.
    expect(asked[0]?.placement).toMatchObject({
      kind: "insert",
      target: { index: 2 },
    });
    expect(editor.getDocument()).toBe(before);
  });
});

describe("keybindings", () => {
  it("fire while focus is inside the iframe as well as outside it", async () => {
    const editor = editorWith(["One", "Two"]);
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const { frameDocument } = mounted;
    const children = editor.getDocument().root.children ?? [];
    const second = children[1]?.id ?? "";

    // Focus really does move into the frame — a keystroke from here never
    // reaches the parent document, which is the whole reason for binding twice.
    const view = frameDocument.defaultView;
    if (!view) throw new Error("The frame has no window.");

    const inside = blockElement(mounted, second);
    // Checked against the frame's own realm: `instanceof` across a document
    // boundary is false however ordinary the element.
    if (!(inside instanceof view.HTMLElement)) {
      throw new Error("The Block did not render to an HTML element.");
    }
    inside.focus();
    expect(frameDocument.activeElement).toBe(inside);

    editor.select(second);
    inside.dispatchEvent(backspace(frameDocument));
    expect(childContents(editor)).toEqual(["One"]);

    editor.select(children[0]?.id ?? "");
    window.document.body.dispatchEvent(backspace(window.document));
    expect(childContents(editor)).toEqual([]);
  });
});

/**
 * Esc, Enter and the arrows move the selection, pressed for real into the
 * frame the way an Author's keyboard would.
 */
describe("stepping through the email with the keyboard", () => {
  it("goes in with Enter, along with the arrows, and out with Escape", async () => {
    const { editor, mounted } = await mountTyped();

    // A click puts the selection on the Block and the focus in the frame.
    await dragPointer([pointOnBlock(mounted, "section", 0.02)]);
    await vi.waitFor(() => {
      expect(editor.getSelection()).toBe("section");
    });

    await pressKey("{Enter}");
    await vi.waitFor(() => {
      expect(editor.getSelection()).toBe("headline");
    });

    await pressKey("{ArrowDown}");
    await vi.waitFor(() => {
      expect(editor.getSelection()).toBe("paragraph");
    });

    await pressKey("{ArrowUp}");
    await vi.waitFor(() => {
      expect(editor.getSelection()).toBe("headline");
    });

    await pressKey("{Escape}");
    await vi.waitFor(() => {
      expect(editor.getSelection()).toBe("section");
    });

    // The root is never stepped onto: the last rung is nothing at all.
    await pressKey("{Escape}");
    await vi.waitFor(() => {
      expect(editor.getSelection()).toBeUndefined();
    });
  });

  it("starts typing on Enter, keeps the arrows for the words, and leaves on Escape", async () => {
    const { editor, mounted } = await mountTyped();

    await dragPointer([centreOfBlock(mounted, "paragraph")]);
    await vi.waitFor(() => {
      expect(editor.getSelection()).toBe("paragraph");
    });

    await pressKey("{Enter}");
    await vi.waitFor(() => {
      expect(editor.getEditing()).toBe("paragraph");
    });

    // Inside the words, the arrows move the caret, not the selection.
    await pressKey("{ArrowUp}");
    await afterAFrame();
    expect(editor.getSelection()).toBe("paragraph");
    expect(editor.getEditing()).toBe("paragraph");

    await pressKey("{Escape}");
    await vi.waitFor(() => {
      expect(editor.getEditing()).toBeUndefined();
      expect(editor.getSelection()).toBe("paragraph");
    });

    await pressKey("{Escape}");
    await vi.waitFor(() => {
      expect(editor.getSelection()).toBe("section");
    });
  });

  it("steps out of a Block in a cell onto the row, not the cell", async () => {
    const editor = createEditor({
      definitions: structuralDefinitions,
      rootType: "email",
      createId: sequentialIds(),
    });
    const root = editor.getDocument().root.id;
    const row = editor.insertBlock("row", root) ?? "";
    const cell = editor.getBlock(row)?.children?.[0]?.id ?? "";
    const text = editor.insertBlock("text", cell, 0, { content: "One" }) ?? "";
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);

    await dragPointer([centreOfBlock(mounted, text)]);
    await vi.waitFor(() => {
      expect(editor.getSelection()).toBe(text);
    });

    await pressKey("{Escape}");
    await vi.waitFor(() => {
      expect(editor.getSelection()).toBe(row);
    });

    await pressKey("{Enter}");
    await vi.waitFor(() => {
      expect(editor.getSelection()).toBe(text);
    });
  });

  it("leaves the arrows to the page when there is nowhere to step", async () => {
    const { editor } = await mountTyped();
    expect(editor.getSelection()).toBeUndefined();
    const arrow = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    });

    window.document.body.dispatchEvent(arrow);

    // Not claimed, so the page still scrolls.
    expect(arrow.defaultPrevented).toBe(false);
    expect(editor.getSelection()).toBeUndefined();
  });

  it("leaves Enter to a button in the Consumer's page", async () => {
    const { host, editor } = await mountTyped();
    editor.select("section");
    const pressed = vi.fn();
    const button = window.document.createElement("button");
    button.textContent = "Mine";
    button.addEventListener("click", () => {
      pressed();
    });
    host.append(button);
    button.focus();

    await pressKey("{Enter}");
    await afterAFrame();

    expect(pressed).toHaveBeenCalledOnce();
    expect(editor.getSelection()).toBe("section");
  });
});

describe("the last Action", () => {
  it("says a press on the Canvas came from the pointer, and a key from a Command", async () => {
    const editor = editorWith(["One", "Two"]);
    const [first, second] = (editor.getDocument().root.children ?? []).map(
      (block) => block.id,
    );
    const mounted = await whenRendered(
      mount(
        <EditorProvider editor={editor}>
          <Canvas />
        </EditorProvider>,
      ),
    );

    await dragPointer([centreOfBlock(mounted, first ?? "")]);
    await vi.waitFor(() => {
      expect(editor.getSelection()).toBe(first);
    });
    expect(editor.getLastAction()).toEqual({
      via: "pointer",
      blocks: [],
      inserted: [],
    });

    // Hovering another Block is not an Action.
    const pressed = editor.getLastAction();
    await movePointer([centreOfBlock(mounted, second ?? "")]);
    await afterAFrame();
    expect(editor.getLastAction()).toBe(pressed);

    await pressKey("{ArrowDown}");
    await vi.waitFor(() => {
      expect(editor.getSelection()).toBe(second);
    });
    expect(editor.getLastAction()?.via).toBe("command");
  });

  it("says a Block dropped from the palette came from the pointer", async () => {
    const editor = editorWith(["One"]);
    const host = mount(
      <EditorProvider editor={editor}>
        <PaletteButton type="text" />
        <Canvas style={{ position: "absolute", top: 60, left: 0 }} />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const first = editor.getDocument().root.children?.[0]?.id ?? "";
    const handle = host.querySelector("[data-testid='palette-text']");
    if (!handle) throw new Error("The palette entry did not render.");

    await dragPointer(
      pathBetween(centreOf(handle), pointOnBlock(mounted, first, 0.8)),
    );

    await vi.waitFor(() => {
      expect(editor.getDocument().root.children).toHaveLength(2);
    });
    const dropped = editor.getDocument().root.children?.[1]?.id;
    expect(editor.getLastAction()).toEqual({
      via: "pointer",
      blocks: [dropped],
      inserted: [dropped],
    });
  });
});

/**
 * The frame is a width and an isolation boundary, not a viewport (ADR-0003).
 * Its height is whatever its content's is, which is what leaves the Consumer's
 * scroller as the only one and keeps every rectangle scroll-independent.
 */
describe("the frame's height", () => {
  it("tracks its content as Blocks are added and removed", async () => {
    const editor = editorWith(["One", "Two"]);
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const frameHeight = (): number =>
      mounted.frame.getBoundingClientRect().height;

    await vi.waitFor(() => {
      expect(frameHeight()).toBeCloseTo(2 * BLOCK_HEIGHT, 0);
    });

    const root = editor.getDocument().root.id;
    editor.insertBlock("text", root, undefined, { content: "Three" });
    await vi.waitFor(() => {
      expect(frameHeight()).toBeCloseTo(3 * BLOCK_HEIGHT, 0);
    });

    // The half that a frame measured from its own viewport gets wrong: it can
    // only ever grow, so an email that loses a Block keeps the room the Block
    // used to take.
    const last = (editor.getDocument().root.children ?? []).at(-1)?.id ?? "";
    editor.removeBlock(last);
    await vi.waitFor(() => {
      expect(frameHeight()).toBeCloseTo(2 * BLOCK_HEIGHT, 0);
    });
  });

  /**
   * Measured from `documentElement`, never from `body`. A root Block may emit a
   * whole email document, and `body` is then the height of the viewport
   * whatever the email inside it does.
   */
  it("follows the content of a root Block that emits a whole email document", async () => {
    const wholeDocument: readonly BlockDefinition[] = [
      defineBlock<Record<string, never>>({
        type: "email",
        label: "Email",
        accepts: [],
        schema: {},
        render: () => (
          <html lang="en">
            <head>
              <title>Newsletter</title>
            </head>
            <body>
              <p style={{ margin: 0, height: 900 }}>Tall</p>
            </body>
          </html>
        ),
      }),
    ];
    const editor = createEditor({
      definitions: wholeDocument,
      rootType: "email",
      createId: sequentialIds("block"),
    });

    // Shorter than the email, so a frame that had taken the viewport's height
    // would stop here rather than reaching the content's 900.
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas />
      </EditorProvider>,
      inAScroller(200),
    );
    const mounted = await whenRendered(host);

    await vi.waitFor(() => {
      expect(
        mounted.frame.getBoundingClientRect().height,
      ).toBeGreaterThanOrEqual(900);
    });
  });
});

describe("a Canvas given a height", () => {
  it("scrolls itself, and keeps its Chrome welded while it does", async () => {
    const editor = editorWith(["One", "Two", "Three", "Four", "Five"]);
    const target = editor.getDocument().root.children?.[4]?.id ?? "";

    // No overflow anywhere in the Consumer's own layout. The Canvas is being
    // asked to provide the scroller itself.
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas height={150} slots={{ selection: SelectionOutline }} />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    editor.select(target);

    const outline = await vi.waitFor(() => {
      const element = host.querySelector("[data-testid='selection']");
      if (!element) throw new Error("No selection Chrome yet.");
      return element;
    });

    const scroller = mounted.frame.closest("div")?.parentElement;
    if (!scroller) throw new Error("The Canvas rendered no scroller.");
    expect(scroller.clientHeight).toBe(150);
    expect(scroller.scrollHeight).toBeCloseTo(5 * BLOCK_HEIGHT, 0);

    // The Chrome for the last Block is below the fold, and reachable: a Canvas
    // that had taken the height on its own element would have clipped it away
    // rather than scrolled to it.
    const drift = (): number =>
      outline.getBoundingClientRect().top -
      (mounted.frame.getBoundingClientRect().top +
        blockElement(mounted, target).getBoundingClientRect().top);

    const before = drift();
    scroller.scrollTop = 100;
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        resolve(undefined);
      });
    });

    expect(scroller.scrollTop).toBe(100);
    expect(drift()).toBeCloseTo(before, 0);
  });

  it("leaves the Consumer's layout alone when it is given no height", async () => {
    const editor = editorWith(["One", "Two"]);
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);

    // The wrapper is `display: contents`, so it generates no box: a Consumer
    // who scrolls the Canvas from their own layout gets the tree they had.
    const wrapper = mounted.frame.closest("div")?.parentElement;
    if (!wrapper) throw new Error("No wrapper.");
    expect(getComputedStyle(wrapper).display).toBe("contents");
  });
});

/**
 * The Canvas answers reveals itself, whosever the scroller is. It has a
 * measured rectangle for every Block and can find whatever holds the overflow;
 * a Consumer left to do it has scroll arithmetic across a document boundary.
 */
describe("revealing a Block", () => {
  it("scrolls the Consumer's own scroller to it", async () => {
    const editor = editorWith(["One", "Two", "Three", "Four", "Five"]);
    const target = editor.getDocument().root.children?.[4]?.id ?? "";

    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas />
      </EditorProvider>,
      inAScroller(150),
    );
    const mounted = await whenRendered(host);
    expect(host.scrollTop).toBe(0);
    expect(inView(mounted, target, host)).toBe(false);

    editor.reveal(target);

    // Nothing was subscribed by this test. The Canvas walked up, found the
    // overflow on the Consumer's element, and scrolled it.
    await vi.waitFor(() => {
      expect(inView(mounted, target, host)).toBe(true);
    });
    expect(host.scrollTop).toBeGreaterThan(0);
  });

  it("scrolls its own scroller to it when it was given a height", async () => {
    const editor = editorWith(["One", "Two", "Three", "Four", "Five"]);
    const target = editor.getDocument().root.children?.[4]?.id ?? "";

    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas height={150} />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const scroller = mounted.frame.closest("div")?.parentElement;
    if (!scroller) throw new Error("The Canvas rendered no scroller.");
    expect(inView(mounted, target, scroller)).toBe(false);

    editor.reveal(target);

    await vi.waitFor(() => {
      expect(inView(mounted, target, scroller)).toBe(true);
    });
  });
});

/** A grip that takes the pointer, in the hovered Block's corner. */
function HoverGrip({ block, rect }: BlockChromeProps): ReactNode {
  return (
    <div
      data-testid="hover-grip"
      data-block={block.id}
      style={{
        position: "absolute",
        top: rect.top + 2,
        left: rect.left + 2,
        width: 16,
        height: 20,
        pointerEvents: "auto",
      }}
    />
  );
}

describe("hover is editor state", () => {
  /** Where the hover Slot drew, by Block. */
  function HoverMark({ block, rect }: BlockChromeProps): ReactNode {
    return (
      <div
        data-testid="hover"
        data-block={block.id}
        style={{ position: "absolute", ...toStyle(rect) }}
      />
    );
  }

  it("sets the editor's hover from the pointer, and clears it on leaving", async () => {
    const editor = editorWith(["One", "Two"]);
    const [first, second] = (editor.getDocument().root.children ?? []).map(
      (child) => child.id,
    );
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas slots={{ hover: HoverMark }} />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);

    await movePointer([centreOfBlock(mounted, first ?? "")]);
    await vi.waitFor(() => {
      expect(editor.getHovered()).toBe(first);
    });

    await movePointer([centreOfBlock(mounted, second ?? "")]);
    await vi.waitFor(() => {
      expect(editor.getHovered()).toBe(second);
    });

    const outside = mounted.frame.getBoundingClientRect();
    await movePointer([{ x: outside.right + 40, y: outside.top + 10 }]);
    await vi.waitFor(() => {
      expect(editor.getHovered()).toBeUndefined();
    });
  });

  it("keeps the hover while the pointer is on the hover Chrome itself", async () => {
    const editor = editorWith(["One", "Two"]);
    const first = editor.getDocument().root.children?.[0]?.id ?? "";
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas slots={{ hover: HoverGrip }} />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);

    await movePointer([centreOfBlock(mounted, first)]);
    const grip = await vi.waitFor(() => {
      const element = host.querySelector("[data-testid='hover-grip']");
      if (!element) throw new Error("No hover Chrome yet.");
      return element;
    });

    // Off the email and onto the Chrome drawn over it: still over the Canvas.
    await movePointer([centreOf(grip)]);
    for (let frame = 0; frame < 5; frame += 1) await afterAFrame();

    expect(editor.getHovered()).toBe(first);
    expect(host.querySelector("[data-testid='hover-grip']")).not.toBeNull();
  });

  it("draws the hover Chrome for a Block hovered from outside the Canvas", async () => {
    const editor = editorWith(["One", "Two"]);
    const second = editor.getDocument().root.children?.[1]?.id ?? "";
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas slots={{ hover: HoverMark }} />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);

    editor.hover(second);

    await vi.waitFor(() => {
      const mark = host.querySelector<HTMLElement>("[data-testid='hover']");
      expect(mark?.dataset.block).toBe(second);
      // Over the Block itself, not merely mounted somewhere.
      const drawn = mark?.getBoundingClientRect();
      const block = blockElement(mounted, second).getBoundingClientRect();
      const frame = mounted.frame.getBoundingClientRect();
      expect(drawn?.top).toBeCloseTo(frame.top + block.top, 0);
      expect(drawn?.height).toBeCloseTo(block.height, 0);
    });

    editor.hover(undefined);
    await vi.waitFor(() => {
      expect(host.querySelector("[data-testid='hover']")).toBeNull();
    });
  });
});

describe("hovering while the email moves", () => {
  /**
   * The second defect the scroll lag was riding with. `hovered` only ever
   * changed on `pointermove`, so a scroll under a stationary cursor left the
   * outline on the Block that had moved away — and the press that followed
   * selected the Block the Author was actually looking at, which was a
   * different one.
   */
  it("selects the Block under a pointer that did not move while the email did", async () => {
    const editor = editorWith(["One", "Two", "Three", "Four", "Five"]);
    const children = editor.getDocument().root.children ?? [];

    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas />
      </EditorProvider>,
      inAScroller(150),
    );
    const mounted = await whenRendered(host);

    // Parked over the first Block and left there. Every position change from
    // here is the email's, not the pointer's.
    const resting = centreOfBlock(mounted, children[0]?.id ?? "");
    await holdPointer([resting]);
    await releasePointer();
    await vi.waitFor(() => {
      expect(editor.getSelection()).toBe(children[0]?.id);
    });

    /** Which Block is genuinely beneath the resting pointer, right now. */
    const underPointer = (): string | undefined => {
      const frame = mounted.frame.getBoundingClientRect();
      return mounted.frameDocument
        .elementFromPoint(resting.x - frame.left, resting.y - frame.top)
        ?.closest<HTMLElement>("[data-block-id]")?.dataset.blockId;
    };

    host.scrollTop = 150;
    await vi.waitFor(() => {
      // The frame itself has not scrolled — it has nothing to scroll — and two
      // and a half Blocks have passed under a cursor that never moved.
      expect(mounted.frameDocument.documentElement.scrollTop).toBe(0);
      expect(underPointer()).not.toBe(children[0]?.id);
    });

    // A press with no move in front of it: exactly the gesture that used to
    // select something other than the Block wearing the outline.
    const arrived = underPointer();
    // Hover is the editor's, so a tree beside the Canvas follows it too.
    await vi.waitFor(() => {
      expect(editor.getHovered()).toBe(arrived);
    });
    await holdPointer([resting]);
    await releasePointer();

    await vi.waitFor(() => {
      expect(editor.getSelection()).toBe(arrived);
    });
  });
});

describe("edge scrolling", () => {
  it("scrolls the Consumer's scroller while a palette drag lingers at its lower edge", async () => {
    const editor = editorWith(["One", "Two", "Three", "Four", "Five", "Six"]);
    // The overflow is the Consumer's, wherever they put it. The frame is as
    // tall as the email and has nothing of its own to scroll.
    const host = mount(
      <EditorProvider editor={editor}>
        <PaletteButton type="text" />
        <Canvas />
      </EditorProvider>,
      inAScroller(200),
    );
    await whenRendered(host);
    expect(host.scrollTop).toBe(0);

    const handle = host.querySelector("[data-testid='palette-text']");
    if (!handle) throw new Error("The palette entry did not render.");

    // Held just inside the bottom of what can be seen — which is the scroller's
    // edge, not the Canvas's. The Canvas is the height of the whole email, so
    // its own bottom edge is somewhere past the end of the Document and says
    // nothing about whether the Author has run out of room to aim at.
    const well = host.getBoundingClientRect();
    const edge = { x: well.left + well.width / 2, y: well.bottom - 8 };
    await dragPointer([
      ...pathBetween(centreOf(handle), edge).slice(0, -1),
      ...Array.from({ length: 12 }, () => edge),
    ]);

    expect(host.scrollTop).toBeGreaterThan(0);
  });

  it("does not scroll for a Block picked up at the edge until the pointer heads for it", async () => {
    const editor = editorWith(["One", "Two", "Three", "Four", "Five", "Six"]);
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas />
      </EditorProvider>,
      inAScroller(200),
    );
    const mounted = await whenRendered(host);

    // A Block under the bottom edge zone of what can be seen.
    const well = host.getBoundingClientRect();
    const y = well.bottom - 10;
    const under = (editor.getDocument().root.children ?? []).find((child) => {
      const rect = drawnRectOf(mounted, child.id);
      return rect.top <= y && rect.bottom >= y;
    });
    if (!under) throw new Error("No Block sits at the bottom edge.");
    const x = centreOfBlock(mounted, under.id).x;

    // Picked up and carried sideways, past the drag threshold, then held.
    await holdPointer([
      { x, y },
      { x: x + 4, y },
      { x: x + 12, y },
      ...Array.from({ length: 12 }, () => ({ x: x + 12, y })),
    ]);
    for (let frame = 0; frame < 10; frame += 1) await afterAFrame();

    expect(host.scrollTop).toBe(0);
    await pressKey("{Escape}");
    await releasePointer();
  });

  it("resolves the Drop Target against where the pointer ended, not where the email started", async () => {
    const editor = editorWith(["One", "Two", "Three", "Four", "Five", "Six"]);

    const host = mount(
      <EditorProvider editor={editor}>
        <PaletteButton type="text" />
        <Canvas />
      </EditorProvider>,
      inAScroller(200),
    );
    await whenRendered(host);

    const before = new Set(
      (editor.getDocument().root.children ?? []).map((block) => block.id),
    );
    const handle = host.querySelector("[data-testid='palette-text']");
    if (!handle) throw new Error("The palette entry did not render.");

    const well = host.getBoundingClientRect();
    const edge = { x: well.left + well.width / 2, y: well.bottom - 8 };
    await dragPointer([
      ...pathBetween(centreOf(handle), edge).slice(0, -1),
      ...Array.from({ length: 30 }, () => edge),
    ]);

    // The edge scroll carried the email up under a pointer that never moved, so
    // the Block it landed beside is one the drag could not see when it started.
    // Resolving against the Canvas as it stood at drag start would have put it
    // near the top instead.
    await vi.waitFor(() => {
      const children = editor.getDocument().root.children ?? [];
      expect(children).toHaveLength(7);
      expect(
        children.findIndex((block) => !before.has(block.id)),
      ).toBeGreaterThan(1);
    });
  });
});

describe("Chrome", () => {
  /**
   * The claim the whole change rests on, phrased the way it is meant: not that
   * the Chrome catches up with the email, but that there is nothing left to
   * catch up. Both are inside the Consumer's scroller, so the compositor moves
   * them in the same frame and the distance between them never changes.
   *
   * Asserted as that distance rather than as a position, because a position
   * that moved by exactly the scroll would also pass while the Chrome was being
   * put back by JavaScript a frame late — which is the bug.
   */
  it("does not move a Block's rectangle when the scroller moves", async () => {
    const editor = editorWith(["One", "Two", "Three", "Four", "Five"]);
    const target = editor.getDocument().root.children?.[4]?.id ?? "";

    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas width="100%" slots={{ selection: SelectionOutline }} />
      </EditorProvider>,
      inAScroller(150),
    );
    const mounted = await whenRendered(host);
    editor.select(target);

    const outline = await vi.waitFor(() => {
      const element = host.querySelector("[data-testid='selection']");
      if (!element) throw new Error("No selection Chrome yet.");
      return element;
    });

    /** How far the outline sits from its Block, across the frame boundary. */
    const drift = (): number =>
      outline.getBoundingClientRect().top -
      (mounted.frame.getBoundingClientRect().top +
        blockElement(mounted, target).getBoundingClientRect().top);

    const before = drift();
    host.scrollTop = 120;
    // Read on the very next frame, and only that one. Nothing is scheduled to
    // put the outline back — no listener, no measurement, no render — so if
    // this ever needs waiting for, the fix has come undone.
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        resolve(undefined);
      });
    });

    expect(host.scrollTop).toBe(120);
    expect(drift()).toBeCloseTo(before, 0);

    const widthBefore = outline.getBoundingClientRect().width;
    host.style.width = "400px";
    await vi.waitFor(() => {
      const after = outline.getBoundingClientRect();
      expect(after.width).toBeLessThan(widthBefore);
      expect(after.width).toBeCloseTo(
        blockElement(mounted, target).getBoundingClientRect().width,
        0,
      );
    });
  });

  it("follows a Block inserted into a Canvas already on screen", async () => {
    // What a Text Engine does: the Block renders an element with nothing in it,
    // and the surface arrives in an effect, after the pass that measured it.
    // Inserted into a mounted Canvas, because that is when it goes wrong — an
    // insertion measures once, in a layout effect, and nothing about the Block
    // growing afterwards changes the Document for a second pass to notice.
    const lateDefinitions: readonly BlockDefinition[] = [
      defineBlock<Record<string, never>>({
        type: "email",
        label: "Email",
        accepts: ["late"],
        schema: {},
        render: ({ children }) => <div>{children}</div>,
      }),
      defineBlock<Record<string, never>>({
        type: "late",
        label: "Late",
        schema: {},
        render: () => (
          <p style={{ margin: 0 }}>
            <LateSurface />
          </p>
        ),
      }),
    ];
    const editor = createEditor({
      definitions: lateDefinitions,
      rootType: "email",
      createId: sequentialIds("block"),
    });

    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas slots={{ selection: SelectionOutline }} />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);

    const target = editor.insertBlock("late", editor.getDocument().root.id);
    if (target === undefined) throw new Error("The Block was refused.");
    editor.select(target);

    const outline = await vi.waitFor(() => {
      const element = host.querySelector("[data-testid='selection']");
      if (!element) throw new Error("No selection Chrome yet.");
      return element;
    });

    await vi.waitFor(() => {
      const block = blockElement(mounted, target).getBoundingClientRect();
      // The surface really did arrive: an outline that agreed with a Block
      // still waiting for one would agree about nothing.
      expect(block.height).toBeCloseTo(BLOCK_HEIGHT, 0);

      const chrome = outline.getBoundingClientRect();
      expect(chrome.height).toBeCloseTo(block.height, 0);
      expect(chrome.top).toBeCloseTo(
        mounted.frame.getBoundingClientRect().top + block.top,
        0,
      );
    });
  });
});

/** A Text Engine's surface: the Block is empty until an effect mounts it. */
function LateSurface(): ReactNode {
  const [surface, setSurface] = useState(false);
  useEffect(() => {
    setSurface(true);
  }, []);
  return surface ? (
    <span style={{ display: "inline-block", height: BLOCK_HEIGHT }} />
  ) : null;
}

/** A Consumer's selection outline: absolutely positioned, four numbers. */
function SelectionOutline({ rect }: BlockChromeProps): ReactNode {
  return (
    <div
      data-testid="selection"
      style={{
        position: "absolute",
        boxSizing: "border-box",
        ...toStyle(rect),
      }}
    />
  );
}

function toStyle(rect: Rect): {
  top: number;
  left: number;
  width: number;
  height: number;
} {
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * A resolver that records what it was asked and never answers, so the Document
 * stays as it was for the duration of the test.
 */
function recordingResolver(): {
  readonly resolve: ImageResolver;
  readonly asked: ImageRequest[];
} {
  const asked: ImageRequest[] = [];
  return {
    asked,
    resolve: (request) => {
      asked.push(request);
      return new Promise<Asset | undefined>(() => {
        // Held open: an Author is looking at a gallery dialog.
      });
    },
  };
}

/** A Consumer's drop indicator, drawn from the rectangle it is handed. */
function DropLine({ rect }: DropIndicatorProps): ReactNode {
  return (
    <div
      data-testid="drop-indicator"
      style={{
        position: "absolute",
        boxSizing: "border-box",
        ...toStyle(rect),
      }}
    />
  );
}

/** A Consumer's placeholder for an image that has not arrived yet. */
function PendingPlaceholder({ rect }: PendingImageProps): ReactNode {
  return (
    <div
      data-testid="pending-image"
      style={{
        position: "absolute",
        boxSizing: "border-box",
        ...toStyle(rect),
      }}
    />
  );
}

/** A Consumer's palette entry, rendered in their own markup. */
/**
 * A drop that will not happen.
 *
 * The combinations live in `drop-target.test.ts`, where they are a pure
 * function and need no layout engine. What cannot be reached there is the
 * wiring — that a refusal actually reaches the screen, the cursor and the
 * Consumer's callback — which is the half that was missing entirely.
 */
describe("refusing a drop", () => {
  it("says why while the drag is held, and reports it on release", async () => {
    const editor = editorWithSections([["One", "Two"]]);
    const refusals: unknown[] = [];
    const host = mount(
      <EditorProvider editor={editor}>
        {/* Nothing accepts an email, so this is refused everywhere. */}
        <PaletteButton type="email" />
        <Canvas
          style={{ position: "absolute", top: 60, left: 0 }}
          onDropRefused={(refusal) => refusals.push(refusal)}
        />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const stack = editor.getDocument().root.children?.[0];
    const text = stack?.children?.[0];
    if (!stack || !text) throw new Error("The fixture did not render.");

    const handle = host.querySelector("[data-testid='palette-email']");
    if (!handle) throw new Error("The palette entry did not render.");

    await holdPointer(
      pathBetween(centreOf(handle), centreOfBlock(mounted, text.id)),
    );

    await vi.waitFor(() => {
      // Named for the Stack around the text, not the text under the pointer:
      // a text Block is not a place, and is not what the Author was aiming at.
      const tip = host.querySelector("[role='status']");
      expect(tip?.textContent).toBe("Email is not allowed inside Stack.");
      expect(window.document.body.style.cursor).toBe("not-allowed");
      // The entry still in the Author's hand says so too.
      expect(
        host.querySelector<HTMLElement>("[data-testid='palette-email']")
          ?.dataset["refused"],
      ).toBe("true");
    });

    await releasePointer();

    await vi.waitFor(() => {
      expect(refusals).toEqual([
        {
          code: "not-accepted",
          message: "Email is not allowed inside Stack.",
          blockId: stack.id,
        },
      ]);
      // Nothing drawn, nothing cursored, and nothing added to the email.
      expect(host.querySelector("[role='status']")).toBeNull();
      expect(window.document.body.style.cursor).toBe("");
      expect(sectionContents(editor)).toEqual([["One", "Two"]]);
    });
  });

  it("says nothing while the drag is not over the email at all", async () => {
    const editor = editorWithSections([["One"]]);
    const refusals: unknown[] = [];
    const host = mount(
      <EditorProvider editor={editor}>
        <PaletteButton type="email" />
        <Canvas
          style={{ position: "absolute", top: 60, left: 0 }}
          onDropRefused={(refusal) => refusals.push(refusal)}
        />
      </EditorProvider>,
    );
    await whenRendered(host);

    const handle = host.querySelector("[data-testid='palette-email']");
    if (!handle) throw new Error("The palette entry did not render.");

    // Held over the palette it was picked up from. Nothing has refused it —
    // it is not over the email — and carrying a Block back here to let go is
    // how an Author abandons a drag.
    const from = centreOf(handle);
    await holdPointer(pathBetween(from, { x: from.x + 20, y: from.y }));

    expect(host.querySelector("[role='status']")).toBeNull();
    expect(window.document.body.style.cursor).not.toBe("not-allowed");

    await releasePointer();

    await vi.waitFor(() => {
      expect(refusals).toEqual([]);
      expect(sectionContents(editor)).toEqual([["One"]]);
    });
  });
});

/**
 * A row whose cells are structural, laid out side by side with real widths.
 *
 * The Preset's own columns would do, but they are table markup: this is about
 * whether a Block is registered as draggable at all, not about `<td>`.
 */
const structuralDefinitions: readonly BlockDefinition[] = [
  defineBlock<Record<string, never>>({
    type: "email",
    label: "Email",
    accepts: ["row", "text"],
    schema: {},
    render: ({ children }) => <div>{children}</div>,
  }),
  defineBlock<Record<string, never>>({
    type: "row",
    label: "Row",
    accepts: ["cell"],
    minChildren: 2,
    maxChildren: 4,
    schema: {},
    render: ({ children }) => (
      <div style={{ display: "flex", gap: 0 }}>{children}</div>
    ),
  }),
  defineBlock<Record<string, never>>({
    type: "cell",
    label: "Cell",
    structural: true,
    accepts: ["text"],
    schema: {},
    render: ({ children }) => (
      <div style={{ width: 300, minHeight: BLOCK_HEIGHT }}>{children}</div>
    ),
  }),
  defineBlock<{ content: string }>({
    type: "text",
    label: "Text",
    schema: {
      content: { kind: "text", label: "Content", defaultValue: "Text" },
    },
    render: ({ props }) => (
      <p
        style={{
          margin: 0,
          height: BLOCK_HEIGHT,
          lineHeight: `${BLOCK_HEIGHT}px`,
        }}
      >
        {props.content}
      </p>
    ),
  }),
];

/** The ids of one row's cells, which is what the claims below are about. */
const cellsOf = (editor: Editor, rowIndex: number): readonly string[] =>
  (editor.getDocument().root.children?.[rowIndex]?.children ?? []).map(
    (cell) => cell.id,
  );

function Palette(): ReactNode {
  const entries = usePalette();
  return (
    <ul data-testid="palette">
      {entries.map((entry) => (
        <li key={entry.type} data-testid={`entry-${entry.type}`}>
          {entry.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * A grip the Consumer draws, in the Chrome layer outside the frame, that moves
 * the Block it is drawn over (ADR-0008). Drawn as a `<button>`, because that is
 * what a grip naturally is — for focus, and for a screen reader.
 *
 * Why this works at all: dnd-kit's pointer sensor binds `pointerdown` to
 * `source.handle ?? source.element`, in whichever document that element lives,
 * and listens for moves on every same-origin document. So a handle in the
 * parent drives a draggable in the frame.
 *
 * It costs two things, and these cases are what pin them.
 *
 * - dnd-kit maps every pointer event into the top document by the frame
 *   transform of the Block, whatever document the event came from. A press on
 *   a grip is already in the parent's coordinates, so it is shifted twice and
 *   reported one frame-offset down and right. The Canvas takes the second
 *   shift back out (`pointerOf` in `canvas/canvas.tsx`). Left in, the first
 *   case lands after the first Block instead of before it. Taken out twice,
 *   the 0.8 drop in the "away and back" case lands before the first Block
 *   instead of after it.
 * - The Canvas refuses a press on a form control unless the control is the
 *   draggable's element, and with a handle the element is still the Block. So
 *   the rule exempts a press inside the handle, or a `<button>` grip would
 *   never start a drag. The grip these cases press is a `<button>`.
 *
 * The cell case pins the same shift across: there the frame's left offset
 * decides which cell a drop lands in.
 */
describe("a Block moved by its grip", () => {
  async function mountWithGrips(contents: readonly string[]): Promise<{
    readonly host: HTMLElement;
    readonly editor: Editor;
    readonly mounted: MountedCanvas;
    readonly blocks: readonly string[];
  }> {
    const editor = editorWith(contents);
    const blocks = (editor.getDocument().root.children ?? []).map((b) => b.id);
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas slots={{ selection: GripChrome }} />
      </EditorProvider>,
    );
    return { host, editor, mounted: await whenRendered(host), blocks };
  }

  it("lands where the last move put the pointer, with no move after it", async () => {
    const { editor, mounted, blocks } = await mountWithGrips([
      "One",
      "Two",
      "Three",
    ]);
    const first = blocks[0] ?? "";
    const third = blocks[2] ?? "";
    editor.select(third);

    // Unlike `pathBetween`, the end is not repeated: the last move is one
    // long jump, and the button is let go straight after it. A move read one
    // event late would land where the pointer was before the jump.
    const from = centreOf(await gripOf(third));
    const to = pointOnBlock(mounted, first, 0.2);
    await dragPointer([
      from,
      { x: from.x + 3, y: from.y + 3 },
      { x: from.x + 8, y: from.y + 8 },
      to,
    ]);

    await vi.waitFor(() => {
      expect(childContents(editor)).toEqual(["Three", "One", "Two"]);
    });
  });

  it("lands where the button came up, before that move is told", async () => {
    const { editor, mounted, blocks } = await mountWithGrips([
      "One",
      "Two",
      "Three",
    ]);
    const first = blocks[0] ?? "";
    const third = blocks[2] ?? "";
    editor.select(third);

    // The backend holds each move back to the next frame. A button let go in
    // the same task as the last move comes up before that move is heard.
    const grip = await gripOf(third);
    const from = centreOf(grip);
    const to = pointOnBlock(mounted, first, 0.2);
    grip.dispatchEvent(pointer("pointerdown", from));
    for (const step of [8, 16, 24]) {
      document.dispatchEvent(
        pointer("pointermove", { x: from.x + step, y: from.y + step }),
      );
      await nextFrame();
    }
    document.dispatchEvent(pointer("pointermove", to));
    document.dispatchEvent(pointer("pointerup", to));

    await vi.waitFor(() => {
      expect(childContents(editor)).toEqual(["Three", "One", "Two"]);
    });
  });

  it("moves the Block, landing where the pointer is", async () => {
    const { editor, mounted, blocks } = await mountWithGrips([
      "One",
      "Two",
      "Three",
    ]);
    const first = blocks[0] ?? "";
    const second = blocks[1] ?? "";
    const third = blocks[2] ?? "";
    editor.select(third);

    // A fifth of the way down the first Block: above its midpoint, so before
    // it. Read one frame-offset too far down, as the backend reports a press
    // from outside the frame, it would land after it instead.
    await dragPointer(
      pathBetween(
        centreOf(await gripOf(third)),
        pointOnBlock(mounted, first, 0.2),
      ),
    );

    await vi.waitFor(() => {
      expect(childContents(editor)).toEqual(["Three", "One", "Two"]);
      expect(renderedOrder(mounted, editor.getDocument().root.id)).toEqual([
        third,
        first,
        second,
      ]);
    });
  });

  it("carries its preview at the pointer, not at the Block", async () => {
    const editor = editorWith(["One", "Two", "Three"]);
    const blocks = (editor.getDocument().root.children ?? []).map((b) => b.id);
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas
          slots={{ selection: GripChrome, dragPreview: PreviewAtPointer }}
        />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const first = blocks[0] ?? "";
    const third = blocks[2] ?? "";
    editor.select(third);

    // The grip sits outside the Block, so a preview kept at the grab offset
    // would hang off to one side of the pointer.
    const to = pointOnBlock(mounted, first, 0.2);
    await holdPointer(pathBetween(centreOf(await gripOf(third)), to));
    try {
      const preview = await vi.waitFor(() => {
        const element = window.document.querySelector(
          "[data-testid='at-pointer']",
        );
        if (!element) throw new Error("No preview yet.");
        return element.getBoundingClientRect();
      });
      expect(preview.left).toBeCloseTo(to.x, -1);
      expect(preview.top).toBeCloseTo(to.y, -1);
    } finally {
      await releasePointer();
    }
  });

  it("carries its preview at the pointer, at its own size, on a zoomed Canvas", async () => {
    const editor = editorWith(["One", "Two", "Three"]);
    const blocks = (editor.getDocument().root.children ?? []).map((b) => b.id);
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas
          zoom={0.5}
          slots={{ selection: GripChrome, dragPreview: PreviewAtPointer }}
        />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const first = blocks[0] ?? "";
    const third = blocks[2] ?? "";
    editor.select(third);

    const to = pointOnBlock(mounted, first, 0.2);
    await holdPointer(pathBetween(centreOf(await gripOf(third)), to));
    try {
      const preview = await vi.waitFor(() => {
        const element = window.document.querySelector<HTMLElement>(
          "[data-testid='at-pointer']",
        );
        if (!element) throw new Error("No preview yet.");
        return element;
      });
      const box = preview.getBoundingClientRect();
      expect(box.left).toBeCloseTo(to.x, -1);
      expect(box.top).toBeCloseTo(to.y, -1);
      // The preview is the Consumer's markup at the Consumer's size, not
      // shrunk with the email.
      expect(box.width).toBeCloseTo(preview.offsetWidth, 0);
    } finally {
      await releasePointer();
    }
  });

  it("leaves every Block's body selecting it and starting no drag", async () => {
    const editor = editorWith(["One", "Two", "Three"]);
    const blocks = (editor.getDocument().root.children ?? []).map((b) => b.id);
    const first = blocks[0] ?? "";
    // The handle lives beside the Canvas, so a Block has one before it is
    // selected — and the press is what has to select it. Only the third Block
    // has one, and that is enough to make every Block grip-only (ADR-0043).
    const host = mount(
      <EditorProvider editor={editor}>
        <LayerRow blockId={blocks[2] ?? ""} />
        <Canvas style={{ position: "absolute", top: 60, left: 0 }} />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    expect(editor.getSelection()).toBeUndefined();

    for (const block of blocks) {
      // A long drag onto the first Block, and a click that slips.
      const from = centreOfBlock(mounted, block);
      await dragPointer(pathBetween(from, pointOnBlock(mounted, first, 0.2)));
      await afterAFrame();
      await dragPointer(pathBetween(from, { x: from.x + 12, y: from.y + 8 }));
      await afterAFrame();

      expect(childContents(editor)).toEqual(["One", "Two", "Three"]);
      expect(editor.getSelection()).toBe(block);
    }
  });

  it("drags every Block from its body again once the last handle goes", async () => {
    const editor = editorWith(["One", "Two", "Three"]);
    const blocks = (editor.getDocument().root.children ?? []).map((b) => b.id);
    const first = blocks[0] ?? "";
    const second = blocks[1] ?? "";
    function Editor(): ReactNode {
      const [grip, setGrip] = useState(true);
      return (
        <EditorProvider editor={editor}>
          <button
            type="button"
            data-testid="drop-grip"
            onClick={() => {
              setGrip(false);
            }}
          >
            Drop the grip
          </button>
          {grip ? <LayerRow blockId={blocks[2] ?? ""} /> : null}
          <Canvas style={{ position: "absolute", top: 60, left: 0 }} />
        </EditorProvider>
      );
    }
    const host = mount(<Editor />);
    let mounted = await whenRendered(host);

    await dragPointer(
      pathBetween(
        centreOfBlock(mounted, second),
        pointOnBlock(mounted, first, 0.2),
      ),
    );
    await afterAFrame();
    expect(childContents(editor)).toEqual(["One", "Two", "Three"]);

    host.querySelector<HTMLElement>("[data-testid='drop-grip']")?.click();
    await vi.waitFor(() => {
      expect(host.querySelector("[data-testid='layer']")).toBeNull();
    });
    mounted = await whenRendered(host);
    await dragPointer(
      pathBetween(
        centreOfBlock(mounted, second),
        pointOnBlock(mounted, first, 0.2),
      ),
    );
    await vi.waitFor(() => {
      expect(childContents(editor)).toEqual(["Two", "One", "Three"]);
    });
  });

  it("keeps a Block in the air when its grip stands down and another Block has one", async () => {
    // The selection Slot stands down once a drag starts, so the grip that
    // started it goes. The layer row keeps the editor grip-only all the while.
    const editor = editorWith(["One", "Two", "Three"]);
    const [first = "", second = "", third = ""] = (
      editor.getDocument().root.children ?? []
    ).map((b) => b.id);
    const host = mount(
      <EditorProvider editor={editor}>
        <LayerRow blockId={second} />
        <Canvas
          slots={{ selection: GripChrome }}
          style={{ position: "absolute", top: 60, left: 0 }}
        />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    editor.select(third);

    await dragPointer(
      pathBetween(
        centreOf(await gripOf(third)),
        pointOnBlock(mounted, first, 0.2),
      ),
    );
    await vi.waitFor(() => {
      expect(childContents(editor)).toEqual(["Three", "One", "Two"]);
    });
  });

  it("still moves the Block after the selection has been away and back", async () => {
    const { host, editor, mounted, blocks } = await mountWithGrips([
      "One",
      "Two",
      "Three",
    ]);
    const first = blocks[0] ?? "";
    const third = blocks[2] ?? "";
    editor.select(third);
    await gripOf(third);
    editor.select(first);
    await gripOf(first);
    editor.select(third);

    await dragPointer(
      pathBetween(
        centreOf(await gripOf(third)),
        pointOnBlock(mounted, first, 0.2),
      ),
    );
    await vi.waitFor(() => {
      expect(childContents(editor)).toEqual(["Three", "One", "Two"]);
    });

    // And again: the move rebuilt every draggable, and the grip has to find
    // the new one.
    const moved = await whenRendered(host);
    await dragPointer(
      pathBetween(
        centreOf(await gripOf(third)),
        pointOnBlock(moved, first, 0.8),
      ),
    );
    await vi.waitFor(() => {
      expect(childContents(editor)).toEqual(["One", "Three", "Two"]);
    });

    // The body of the Block still starts nothing.
    const settled = await whenRendered(host);
    await dragPointer(
      pathBetween(
        centreOfBlock(settled, third),
        pointOnBlock(settled, first, 0.2),
      ),
    );
    await afterAFrame();
    expect(childContents(editor)).toEqual(["One", "Three", "Two"]);
  });

  it("lands in the cell the pointer is over, a frame-offset from its edge", async () => {
    // Side by side, so the frame's left offset decides the cell. Each aim is
    // closer to the edge between the cells than the frame is to the page's.
    const editor = createEditor({
      definitions: structuralDefinitions,
      rootType: "email",
      createId: sequentialIds(),
    });
    editor.insertBlock("row", editor.getDocument().root.id);
    const [left = "", right = ""] = cellsOf(editor, 0);
    const one = editor.insertBlock("text", left, 0, { content: "One" }) ?? "";
    const two = editor.insertBlock("text", left, 1, { content: "Two" }) ?? "";
    const three =
      editor.insertBlock("text", right, 0, { content: "Three" }) ?? "";
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas slots={{ selection: GripChrome }} />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const textsIn = (cell: string) =>
      (editor.getBlock(cell)?.children ?? []).map((text) => text.id);
    const frame = mounted.frame.getBoundingClientRect();

    // Near the right edge of "One", low down: after it, in the left cell. Left
    // one offset too far right, it would land in the right cell.
    const oneRect = blockElement(mounted, one).getBoundingClientRect();
    editor.select(three);
    await dragPointer(
      pathBetween(centreOf(await gripOf(three)), {
        x: frame.left + oneRect.right - 20,
        y: frame.top + oneRect.top + oneRect.height * 0.8,
      }),
    );
    await vi.waitFor(() => {
      expect(textsIn(left)).toEqual([one, three, two]);
      expect(textsIn(right)).toEqual([]);
    });

    // Just inside the empty right cell. Taken out twice, the offset would
    // put it back in the left cell.
    const settled = await whenRendered(host);
    const rightRect = blockElement(settled, right).getBoundingClientRect();
    editor.select(two);
    await dragPointer(
      pathBetween(centreOf(await gripOf(two)), {
        x: frame.left + rightRect.left + 20,
        y: frame.top + rightRect.top + rightRect.height / 2,
      }),
    );
    await vi.waitFor(() => {
      expect(textsIn(left)).toEqual([one, three]);
      expect(textsIn(right)).toEqual([two]);
    });
  });

  it("tells a grip outside the Canvas that its Block is in the air", async () => {
    const editor = editorWith(["One", "Two"]);
    const first = editor.getDocument().root.children?.[0]?.id ?? "";
    const second = editor.getDocument().root.children?.[1]?.id ?? "";
    const host = mount(
      <EditorProvider editor={editor}>
        <LayerRow blockId={second} />
        <Canvas style={{ position: "absolute", top: 60, left: 0 }} />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const row = host.querySelector<HTMLElement>("[data-testid='layer']");
    if (!row) throw new Error("The layer row did not render.");
    expect(row.dataset.dragging).toBe("false");

    await holdPointer(
      pathBetween(centreOf(row), pointOnBlock(mounted, first, 0.2)),
    );
    try {
      await vi.waitFor(() => {
        expect(row.dataset.dragging).toBe("true");
      });
    } finally {
      await releasePointer();
    }
    await vi.waitFor(() => {
      expect(childContents(editor)).toEqual(["Two", "One"]);
      expect(row.dataset.dragging).toBe("false");
    });
  });
});

/** The selected Block's Chrome: a grip in its top-left corner. */
/**
 * A mouse event made by hand, for a test that has to send two in one task,
 * which a real mouse cannot be made to do.
 */
function pointer(
  type: string,
  at: { readonly x: number; readonly y: number },
): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: at.x,
    clientY: at.y,
    isPrimary: true,
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
    pointerId: 1,
    pointerType: "mouse",
  });
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

function GripChrome({ block, rect }: BlockChromeProps): ReactNode {
  const { dragHandleProps } = useBlockDrag(block.id);
  return (
    <button
      type="button"
      aria-label="Move"
      data-testid={`grip-${block.id}`}
      style={{
        position: "absolute",
        top: rect.top,
        left: rect.left,
        width: 24,
        height: 24,
        padding: 0,
        border: 0,
        // The Chrome layer ignores the pointer; a grip takes it back.
        pointerEvents: "auto",
      }}
      {...dragHandleProps}
    />
  );
}

/** A row in a Consumer's layers panel, beside the Canvas rather than on it. */
function LayerRow({ blockId }: { readonly blockId: string }): ReactNode {
  const { dragHandleProps, isDragging } = useBlockDrag(blockId);
  return (
    <div
      data-testid="layer"
      data-dragging={String(isDragging)}
      style={{ width: 120, height: 40 }}
      {...dragHandleProps}
    >
      Layer
    </div>
  );
}

function gripOf(blockId: string): Promise<Element> {
  return vi.waitFor(() => {
    const grip = window.document.querySelector(
      `[data-testid='grip-${blockId}']`,
    );
    if (!grip) throw new Error(`No grip for ${blockId} yet.`);
    return grip;
  });
}

describe("a Block that belongs to its parent", () => {
  /** Two rows of two cells, with one piece of text in the first cell. */
  function editorWithRows(): Editor {
    const editor = createEditor({
      definitions: structuralDefinitions,
      rootType: "email",
      createId: sequentialIds(),
    });
    const root = editor.getDocument().root.id;
    const first = editor.insertBlock("row", root) ?? "";
    editor.insertBlock("row", root);
    const cell = editor.getBlock(first)?.children?.[0]?.id ?? "";
    editor.insertBlock("text", cell, 0, { content: "One" });
    return editor;
  }

  it("is not offered in the palette", async () => {
    const editor = editorWithRows();
    const host = mount(
      <EditorProvider editor={editor}>
        <Palette />
        <Canvas />
      </EditorProvider>,
    );
    await whenRendered(host);

    // The row is there to drag; the cell it is made of is not.
    expect(host.querySelector("[data-testid='entry-row']")).not.toBeNull();
    expect(host.querySelector("[data-testid='entry-cell']")).toBeNull();
  });

  it("is never what a drag carries — the row that owns it goes instead", async () => {
    const editor = editorWithRows();
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const firstRow = cellsOf(editor, 0);
    const secondRow = cellsOf(editor, 1);
    // Aimed at the cell holding nothing. A pointer on the first cell would land
    // on the text inside it and carry that, which is a different gesture.
    const [targetCell] = cellsOf(editor, 1);

    await dragPointer(
      pathBetween(
        centreOfBlock(mounted, firstRow[1] ?? ""),
        centreOfBlock(mounted, targetCell ?? ""),
      ),
    );

    await vi.waitFor(() => {
      const rows = (editor.getDocument().root.children ?? []).map((row) =>
        (row.children ?? []).map((cell) => cell.id),
      );

      // The gesture was live — the rows swapped, because a press inside a cell
      // reaches the nearest Block an Author may actually carry.
      expect(rows).toEqual([secondRow, firstRow]);
      // And no cell changed hands, so neither row was ever left short.
      expect(rows).toContainEqual(firstRow);
      expect(rows).toContainEqual(secondRow);
    });
  });

  it("still lets content be dragged out of it, leaving it empty", async () => {
    // The minimum counts cells inside a row, never content inside a cell. This
    // is the gesture an Author actually reaches for to rearrange a row.
    const editor = editorWithRows();
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const [, secondCell] = cellsOf(editor, 0);
    const textId =
      editor.getDocument().root.children?.[0]?.children?.[0]?.children?.[0]?.id;

    await dragPointer(
      pathBetween(
        centreOfBlock(mounted, textId ?? ""),
        centreOfBlock(mounted, secondCell ?? ""),
      ),
    );

    await vi.waitFor(() => {
      const cells = editor.getDocument().root.children?.[0]?.children ?? [];
      expect(cells[0]?.children).toEqual([]);
      expect(cells[1]?.children).toHaveLength(1);
    });
  });

  it("is never what a press selects — the row that owns it goes instead", async () => {
    const editor = editorWithRows();
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const rowId = editor.getDocument().root.children?.[0]?.id ?? "";
    // The cell holding nothing, so the press meets the cell itself rather than
    // content sitting inside it.
    const [, emptyCell] = cellsOf(editor, 0);

    pressOn(mounted, emptyCell ?? "");

    // The row a Consumer's Inspector then describes, which is the whole point:
    // the row is where a cell's width, padding and background are edited.
    await vi.waitFor(() => {
      expect(editor.getSelection()).toBe(rowId);
    });
  });

  it("does not swallow a press meant for the content inside it", async () => {
    // The walk stops at the first Block an Author may reach. Walking all the
    // way to the row would make everything in a column unselectable, which is
    // a far larger rule than the one intended.
    const editor = editorWithRows();
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const textId =
      editor.getDocument().root.children?.[0]?.children?.[0]?.children?.[0]
        ?.id ?? "";

    pressOn(mounted, textId);

    await vi.waitFor(() => {
      expect(editor.getSelection()).toBe(textId);
    });
  });

  it("gives a press on the gap between two columns to the row", async () => {
    // The spacer is the row's own markup, not a Block, so the nearest Block
    // above it is the row.
    const editor = createEditor({
      definitions: createReactEmailPreset(),
      rootType: REACT_EMAIL_ROOT_TYPE,
      createId: sequentialIds(),
    });
    const rowId =
      editor.insertBlock("columns", editor.getDocument().root.id, 0, {
        gap: 24,
      }) ?? "";
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const spacer = blockElement(mounted, rowId).querySelector(
      "td[aria-hidden]",
    );
    const view = mounted.frameDocument.defaultView;
    if (!spacer || !view) throw new Error("The row has no spacer.");

    spacer.dispatchEvent(
      new view.PointerEvent("pointerdown", { bubbles: true }),
    );

    await vi.waitFor(() => {
      expect(editor.getSelection()).toBe(rowId);
    });
  });
});

/** The Chrome an empty container is marked with, in a host. */
const emptyMarks = (host: HTMLElement): readonly HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>("[data-testid='empty']"),
];

/** A Preset heading and paragraph in one Section, with Tiptap mounted. */
async function mountTyped(): Promise<{
  readonly host: HTMLElement;
  readonly editor: Editor;
  readonly mounted: MountedCanvas;
}> {
  const text = createTiptapTextEngine();
  const editor = createEditor({
    definitions: createReactEmailPreset({ contentWidth: 600 }),
    rootType: REACT_EMAIL_ROOT_TYPE,
    document: {
      root: {
        id: "root",
        type: REACT_EMAIL_ROOT_TYPE,
        props: { backgroundColor: "#eceef3", contentWidth: 600 },
        children: [
          {
            id: "section",
            type: "section",
            props: { backgroundColor: "#ffffff", paddingY: 16, paddingX: 24 },
            children: [
              {
                id: "headline",
                type: "heading",
                props: { content: "One timeline", level: 2, fontSize: 21 },
              },
              {
                id: "paragraph",
                type: "text",
                props: {
                  content: "Type a word, drag a Block, undo.",
                  fontSize: 15,
                },
              },
            ],
          },
        ],
      },
    },
    createId: sequentialIds("added"),
    textEngine: text,
  });

  const host = mount(
    <EditorProvider editor={editor} editableText={text.EditableText}>
      <Canvas />
    </EditorProvider>,
  );
  const mounted = await whenRendered(host);
  // The surface arrives in an effect, after the first paint.
  await vi.waitFor(() => {
    if (!mounted.frameDocument.querySelector(".ProseMirror")) {
      throw new Error("The Text Engine has not mounted yet.");
    }
  });
  return { host, editor, mounted };
}

/** Whether the Block is inside the box the Author is looking through. */
function inView(
  mounted: MountedCanvas,
  blockId: string,
  scroller: HTMLElement | Window,
): boolean {
  const box =
    scroller instanceof Window
      ? { top: 0, bottom: scroller.innerHeight }
      : scroller.getBoundingClientRect();
  const block = blockElement(mounted, blockId).getBoundingClientRect();
  const top = mounted.frame.getBoundingClientRect().top + block.top;
  return top >= box.top - 1 && top + block.height <= box.bottom + 1;
}

/** A press on a Block, in the frame's own realm. */
function pressOn(mounted: MountedCanvas, blockId: string): void {
  const view = frameWindow(mounted);
  blockElement(mounted, blockId).dispatchEvent(
    new view.PointerEvent("pointerdown", { bubbles: true }),
  );
}

function PaletteButton({ type }: { readonly type: string }): ReactNode {
  const { dragHandleProps, isRefused } = usePaletteDrag(type);
  return (
    <button
      type="button"
      data-testid={`palette-${type}`}
      data-refused={String(isRefused)}
      style={{ width: 120, height: 40 }}
      {...dragHandleProps}
    >
      {type}
    </button>
  );
}

/** The frame's own realm: an object built in the parent is a foreign one. */
function frameWindow(mounted: MountedCanvas): Window & typeof globalThis {
  const view = mounted.frameDocument.defaultView;
  if (!view) throw new Error("The frame has no window.");
  return view;
}

function fileIn(mounted: MountedCanvas, name: string): File {
  const view = frameWindow(mounted);
  return new view.File(["binary"], name, { type: "image/png" });
}

/**
 * Dispatch a native drag or clipboard event on a Block, carrying a file.
 *
 * The coordinates are in the frame's own viewport, which is exactly what a
 * real event inside the iframe reports — and so exercises the translation the
 * Canvas has to do before resolving where the file would land.
 */
function dispatchInFrame(
  mounted: MountedCanvas,
  blockId: string,
  fractionDown: number,
  build: (
    view: Window & typeof globalThis,
    transfer: DataTransfer,
    point: { clientX: number; clientY: number },
  ) => Event,
  file: File,
): void {
  const view = frameWindow(mounted);
  const element = blockElement(mounted, blockId);
  const rect = element.getBoundingClientRect();

  const transfer = new view.DataTransfer();
  transfer.items.add(file);
  element.dispatchEvent(
    build(view, transfer, {
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height * fractionDown,
    }),
  );
}

/** A keystroke inside the frame, aimed where an Author's would land. */
function press(frameDocument: Document, key: string): void {
  const view = frameDocument.defaultView ?? window;
  const target = frameDocument.activeElement ?? frameDocument.documentElement;
  target.dispatchEvent(
    new view.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}

function backspace(target: Document): KeyboardEvent {
  const view = target.defaultView ?? window;
  return new view.KeyboardEvent("keydown", {
    key: "Backspace",
    bubbles: true,
    cancelable: true,
  });
}
