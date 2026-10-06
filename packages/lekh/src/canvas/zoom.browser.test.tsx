import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  Canvas,
  EditorProvider,
  useBlockDrag,
  usePaletteDrag,
} from "../canvas";
import type {
  BlockChromeProps,
  DropIndicatorProps,
  DropTargetProps,
  Rect,
} from "../canvas";
import { createEditor, defineBlock, type Editor } from "../index";
import { sequentialIds } from "../testing/blocks";
import {
  centreOf,
  centreOfBlock,
  dragPointer,
  drawnRectOf,
  holdPointer,
  mount,
  movePointer,
  pathBetween,
  pointOnBlock,
  releasePointer,
  whenRendered,
  type MountedCanvas,
} from "../testing/browser";

/**
 * A zoomed Canvas (ADR-0039).
 *
 * The email is laid out at the Stage's true width and drawn smaller or larger.
 * What is pinned here is that everything an Author sees and does agrees with
 * the drawn email: the Chrome sits over it, and a press or a drop lands on the
 * Block under the pointer.
 */

const BLOCK_HEIGHT = 60;

const definitions = [
  defineBlock<Record<string, never>>({
    type: "email",
    label: "Email",
    accepts: ["text"],
    schema: {},
    render: ({ children }) => <div>{children}</div>,
  }),
  defineBlock<{ content: string }>({
    type: "text",
    label: "Text",
    schema: {
      content: { kind: "text", label: "Content", defaultValue: "Text" },
    },
    render: ({ props }) => (
      <p style={{ margin: 0, height: BLOCK_HEIGHT }}>{props.content}</p>
    ),
  }),
];

function editorWith(contents: readonly string[]): Editor {
  const editor = createEditor({
    definitions,
    rootType: "email",
    createId: sequentialIds("block"),
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

const blockIds = (editor: Editor): readonly string[] =>
  (editor.getDocument().root.children ?? []).map((block) => block.id);

function Mark({
  testId,
  rect,
}: {
  readonly testId: string;
  readonly rect: Rect;
}): ReactNode {
  return (
    <div
      data-testid={testId}
      style={{
        position: "absolute",
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      }}
    />
  );
}

/** A grip in the page, outside the frame, at the selected Block's corner. */
function Grip({ block, rect }: BlockChromeProps): ReactNode {
  const { dragHandleProps } = useBlockDrag(block.id);
  return (
    <button
      type="button"
      aria-label="Move"
      data-testid="grip"
      style={{
        position: "absolute",
        top: rect.top,
        left: rect.left,
        width: 24,
        height: 24,
        padding: 0,
        border: 0,
        pointerEvents: "auto",
      }}
      {...dragHandleProps}
    />
  );
}

const slots = {
  selection: ({ rect }: BlockChromeProps) => (
    <Mark testId="selection" rect={rect} />
  ),
  hover: ({ rect }: BlockChromeProps) => <Mark testId="hover" rect={rect} />,
  dropIndicator: ({ rect }: DropIndicatorProps) => (
    <Mark testId="drop-indicator" rect={rect} />
  ),
  dropTarget: ({ rect, current }: DropTargetProps) => (
    <Mark
      testId={current ? "drop-target-current" : "drop-target"}
      rect={rect}
    />
  ),
};

function PaletteButton(): ReactNode {
  const { dragHandleProps } = usePaletteDrag("text");
  return (
    <button
      type="button"
      data-testid="palette-text"
      style={{ width: 120, height: 40 }}
      {...dragHandleProps}
    >
      text
    </button>
  );
}

/**
 * A grip takes the drag off the Block's body, so only the test about grips
 * draws one.
 */
const slotsWithGrip = {
  ...slots,
  selection: (props: BlockChromeProps) => (
    <>
      <Mark testId="selection" rect={props.rect} />
      <Grip {...props} />
    </>
  ),
};

async function mountZoomed(
  zoom: number,
  contents: readonly string[],
  { grips = false }: { readonly grips?: boolean } = {},
): Promise<{
  readonly host: HTMLElement;
  readonly editor: Editor;
  readonly mounted: MountedCanvas;
}> {
  const editor = editorWith(contents);
  const host = mount(
    <EditorProvider editor={editor}>
      <PaletteButton />
      <Canvas
        zoom={zoom}
        slots={grips ? slotsWithGrip : slots}
        className="sheet"
        style={{ position: "absolute", top: 60, left: 20 }}
      />
    </EditorProvider>,
    {
      hostStyle:
        "position:absolute; top:30px; left:50px; width:1000px; height:900px;",
    },
  );
  return { host, editor, mounted: await whenRendered(host) };
}

function markOf(host: HTMLElement, testId: string): Promise<Element> {
  return vi.waitFor(() => {
    const element = host.querySelector(`[data-testid='${testId}']`);
    if (!element) throw new Error(`No ${testId} Chrome yet.`);
    return element;
  });
}

function expectOver(chrome: Element, block: DOMRect): void {
  const drawn = chrome.getBoundingClientRect();
  expect(drawn.left).toBeCloseTo(block.left, 0);
  expect(drawn.top).toBeCloseTo(block.top, 0);
  expect(drawn.width).toBeCloseTo(block.width, 0);
  expect(drawn.height).toBeCloseTo(block.height, 0);
}

describe.each([0.8, 1.25])("a Canvas zoomed to %s", (zoom) => {
  it("lays the email out at the Stage's true width, and draws it scaled", async () => {
    const { host, mounted } = await mountZoomed(zoom, ["One"]);

    expect(mounted.frameDocument.documentElement.clientWidth).toBe(600);
    const frame = mounted.frame.getBoundingClientRect();
    expect(frame.width).toBeCloseTo(600 * zoom, 0);

    // The Canvas element takes up the drawn size, so the Consumer's layout
    // makes room for what is on screen rather than for the unscaled email.
    const sheetRect = host.querySelector(".sheet")?.getBoundingClientRect();
    expect(sheetRect?.width).toBeCloseTo(600 * zoom, 0);
    expect(sheetRect?.height).toBeCloseTo(frame.height, 0);
    expect(frame.height).toBeCloseTo(BLOCK_HEIGHT * zoom, 0);
  });

  it("draws the selection and hover over the drawn Block", async () => {
    const { host, editor, mounted } = await mountZoomed(zoom, ["One", "Two"]);
    const [first, second] = blockIds(editor);

    editor.select(second);
    const selection = await markOf(host, "selection");
    await vi.waitFor(() => {
      expectOver(selection, drawnRectOf(mounted, second ?? ""));
    });

    editor.hover(first);
    const hover = await markOf(host, "hover");
    await vi.waitFor(() => {
      expectOver(hover, drawnRectOf(mounted, first ?? ""));
    });
  });

  it("selects and hovers the Block under the pointer", async () => {
    const { editor, mounted } = await mountZoomed(zoom, [
      "One",
      "Two",
      "Three",
    ]);
    const [, , third] = blockIds(editor);

    await movePointer([pointOnBlock(mounted, third ?? "", 0.5)]);
    await vi.waitFor(() => {
      expect(editor.getHovered()).toBe(third);
    });

    await dragPointer([centreOfBlock(mounted, third ?? "")]);
    await vi.waitFor(() => {
      expect(editor.getSelection()).toBe(third);
    });
  });

  it("draws the drop indicator on the drawn edge, and drops there", async () => {
    const { host, editor, mounted } = await mountZoomed(zoom, [
      "One",
      "Two",
      "Three",
    ]);
    const [first, , third] = blockIds(editor);

    await holdPointer(
      pathBetween(
        centreOfBlock(mounted, third ?? ""),
        pointOnBlock(mounted, first ?? "", 0.8),
      ),
    );
    try {
      const indicator = await markOf(host, "drop-indicator");
      const target = drawnRectOf(mounted, first ?? "");
      const drawn = indicator.getBoundingClientRect();
      expect(drawn.top).toBeCloseTo(target.bottom, 0);
      expect(drawn.left).toBeCloseTo(target.left, 0);
      expect(drawn.width).toBeCloseTo(target.width, 0);
    } finally {
      await releasePointer();
    }

    await vi.waitFor(() => {
      expect(childContents(editor)).toEqual(["One", "Three", "Two"]);
    });
  });

  it("draws every place a drag may land on the drawn edges", async () => {
    const { host, editor, mounted } = await mountZoomed(zoom, [
      "One",
      "Two",
      "Three",
    ]);
    const ids = blockIds(editor);
    const [first, , third] = ids;

    await holdPointer(
      pathBetween(
        centreOfBlock(mounted, third ?? ""),
        pointOnBlock(mounted, first ?? "", 0.8),
      ),
    );
    try {
      const current = await markOf(host, "drop-target-current");
      const edges = [
        ...ids.map((id) => drawnRectOf(mounted, id).top),
        drawnRectOf(mounted, third ?? "").bottom,
      ];
      const marks = [
        ...host.querySelectorAll(
          "[data-testid='drop-target'], [data-testid='drop-target-current']",
        ),
      ].map((mark) => mark.getBoundingClientRect().top);

      // Above each Block and below the last, and the one after the first is
      // where the pointer lands.
      expect(marks).toHaveLength(edges.length);
      for (const [index, edge] of edges.entries()) {
        expect(marks[index]).toBeCloseTo(edge, 0);
      }
      expect(current.getBoundingClientRect().top).toBeCloseTo(
        drawnRectOf(mounted, first ?? "").bottom,
        0,
      );
    } finally {
      await releasePointer();
    }

    expect(host.querySelector("[data-testid^='drop-target']")).toBeNull();
  });

  it("drops a Block carried by a grip outside the frame where the pointer is", async () => {
    const { host, editor, mounted } = await mountZoomed(
      zoom,
      ["One", "Two", "Three"],
      { grips: true },
    );
    const [first, , third] = blockIds(editor);
    editor.select(third);
    const grip = await markOf(host, "grip");

    await dragPointer(
      pathBetween(centreOf(grip), pointOnBlock(mounted, first ?? "", 0.2)),
    );

    await vi.waitFor(() => {
      expect(childContents(editor)).toEqual(["Three", "One", "Two"]);
    });
  });

  it("drops a Block from the palette where the pointer is", async () => {
    const { host, editor, mounted } = await mountZoomed(zoom, ["One", "Two"]);
    const [, second] = blockIds(editor);
    const handle = host.querySelector("[data-testid='palette-text']");
    if (!handle) throw new Error("The palette entry did not render.");

    await dragPointer(
      pathBetween(centreOf(handle), pointOnBlock(mounted, second ?? "", 0.8)),
    );

    await vi.waitFor(() => {
      expect(childContents(editor)).toEqual(["One", "Two", undefined]);
    });
  });
});

describe("a Canvas zoomed to fit", () => {
  it("does not scroll sideways once the drawn email fits", async () => {
    const editor = editorWith(["One"]);
    // 520px of room: the email laid out at 600 would not fit, drawn at 480 it
    // does.
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas zoom={0.8} />
      </EditorProvider>,
      {
        hostStyle:
          "position:absolute; top:30px; left:50px; width:520px; height:400px; overflow:auto;",
      },
    );
    await whenRendered(host);
    expect(host.scrollWidth).toBe(host.clientWidth);
  });
});

describe("a Canvas with no zoom", () => {
  it("draws the email at its true size", async () => {
    const editor = editorWith(["One"]);
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    expect(mounted.frame.getBoundingClientRect().width).toBeCloseTo(600, 0);
  });
});
