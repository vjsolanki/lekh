import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { Canvas, EditorProvider } from "../canvas";
import type { BoxEdgesProps } from "../canvas";
import {
  createEditor,
  defineBlock,
  SchemaKind,
  type BoxSide,
  type Editor,
  type SchemaEntry,
} from "../index";
import { createReactEmailPreset, REACT_EMAIL_ROOT_TYPE } from "../blocks";
import { sequentialIds } from "../testing/blocks";
import {
  blockElement,
  mount,
  whenRendered,
  type MountedCanvas,
} from "../testing/browser";

/**
 * The edges of the selected Block's Boxes (ADR-0040), handed to a Slot for
 * grips. Each side is the band its padding fills, drawn at the zoom the email
 * is drawn at (ADR-0039), and names the prop that moves it.
 */

const side = (
  sides: BoxSide | readonly BoxSide[],
  box: string,
  defaultValue: number,
): SchemaEntry<number> => ({
  kind: SchemaKind.number,
  label: box,
  defaultValue,
  box,
  side: sides,
});

type CardProps = {
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  innerY: number;
  innerX: number;
};

const definitions = [
  defineBlock<Record<string, never>>({
    type: "email",
    label: "Email",
    accepts: ["card"],
    schema: {},
    render: ({ children }) => <div>{children}</div>,
  }),
  // Outer padding on the Block's own element, and a label inside with room of
  // its own, the way a button is drawn.
  defineBlock<CardProps>({
    type: "card",
    label: "Card",
    schema: {
      paddingTop: side("top", "padding", 10),
      paddingRight: side("right", "padding", 20),
      paddingBottom: side("bottom", "padding", 30),
      paddingLeft: side("left", "padding", 40),
      innerY: side(["top", "bottom"], "inner", 6),
      innerX: side(["left", "right"], "inner", 12),
    },
    render: ({ props }) => (
      <div
        style={{
          paddingTop: props.paddingTop,
          paddingRight: props.paddingRight,
          paddingBottom: props.paddingBottom,
          paddingLeft: props.paddingLeft,
        }}
      >
        <span
          style={{
            display: "inline-block",
            border: "2px solid black",
            paddingTop: props.innerY,
            paddingBottom: props.innerY,
            paddingLeft: props.innerX,
            paddingRight: props.innerX,
          }}
        >
          Label
        </span>
      </div>
    ),
  }),
];

function cardEditor(props: Partial<CardProps> = {}): Editor {
  const editor = createEditor({
    definitions,
    rootType: "email",
    createId: sequentialIds("block"),
  });
  editor.insertBlock("card", editor.getDocument().root.id, undefined, props);
  return editor;
}

/** One mark per edge, carrying its Box, side and prop. */
function Edges({ edges }: BoxEdgesProps): ReactNode {
  return edges.map((edge) => (
    <div
      key={`${edge.box}:${edge.side}`}
      data-testid={`${edge.box}-${edge.side}`}
      data-prop={edge.prop}
      style={{
        position: "absolute",
        top: edge.rect.top,
        left: edge.rect.left,
        width: edge.rect.width,
        height: edge.rect.height,
      }}
    />
  ));
}

async function mountWith(
  editor: Editor,
  zoom: number,
): Promise<{ readonly host: HTMLElement; readonly mounted: MountedCanvas }> {
  const host = mount(
    <EditorProvider editor={editor}>
      <Canvas
        zoom={zoom}
        slots={{ boxEdges: Edges }}
        style={{ position: "absolute", top: 60, left: 20 }}
      />
    </EditorProvider>,
    {
      hostStyle:
        "position:absolute; top:30px; left:50px; width:1000px; height:900px;",
    },
  );
  return { host, mounted: await whenRendered(host) };
}

function edgeOf(host: HTMLElement, testId: string): Promise<HTMLElement> {
  return vi.waitFor(() => {
    const element = host.querySelector<HTMLElement>(
      `[data-testid='${testId}']`,
    );
    if (!element) throw new Error(`No ${testId} edge yet.`);
    return element;
  });
}

/** An element in the frame, where it is drawn in the test document. */
function drawn(mounted: MountedCanvas, element: Element): DOMRect {
  const frame = mounted.frame.getBoundingClientRect();
  const scale = frame.width / mounted.frame.offsetWidth;
  const rect = element.getBoundingClientRect();
  return new DOMRect(
    frame.left + rect.left * scale,
    frame.top + rect.top * scale,
    rect.width * scale,
    rect.height * scale,
  );
}

function expectAt(
  edge: Element,
  expected: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  },
): void {
  const rect = edge.getBoundingClientRect();
  expect(rect.left).toBeCloseTo(expected.left, 0);
  expect(rect.top).toBeCloseTo(expected.top, 0);
  expect(rect.width).toBeCloseTo(expected.width, 0);
  expect(rect.height).toBeCloseTo(expected.height, 0);
}

const cardId = (editor: Editor): string =>
  editor.getDocument().root.children?.[0]?.id ?? "";

describe.each([1, 0.8])("Box edges at zoom %s", (zoom) => {
  it("hands each side of the outer Box as the band its padding fills", async () => {
    const editor = cardEditor();
    const card = cardId(editor);
    editor.select(card);
    const { host, mounted } = await mountWith(editor, zoom);
    const block = drawn(mounted, blockElement(mounted, card));

    const top = await edgeOf(host, "padding-top");
    await vi.waitFor(() => {
      expectAt(top, {
        left: block.left,
        top: block.top,
        width: block.width,
        height: 10 * zoom,
      });
    });
    expect(top.dataset["prop"]).toBe("paddingTop");

    expectAt(await edgeOf(host, "padding-right"), {
      left: block.right - 20 * zoom,
      top: block.top,
      width: 20 * zoom,
      height: block.height,
    });
    expectAt(await edgeOf(host, "padding-bottom"), {
      left: block.left,
      top: block.bottom - 30 * zoom,
      width: block.width,
      height: 30 * zoom,
    });
    expectAt(await edgeOf(host, "padding-left"), {
      left: block.left,
      top: block.top,
      width: 40 * zoom,
      height: block.height,
    });
  });

  it("hands an inner Box inside the element it pads, inside its border", async () => {
    const editor = cardEditor();
    const card = cardId(editor);
    editor.select(card);
    const { host, mounted } = await mountWith(editor, zoom);
    const label = mounted.frameDocument.querySelector("span");
    if (!label) throw new Error("The label did not render.");
    const box = drawn(mounted, label);
    const border = 2 * zoom;

    const top = await edgeOf(host, "inner-top");
    expect(top.dataset["prop"]).toBe("innerY");
    await vi.waitFor(() => {
      expectAt(top, {
        left: box.left + border,
        top: box.top + border,
        width: box.width - 2 * border,
        height: 6 * zoom,
      });
    });
    const bottom = await edgeOf(host, "inner-bottom");
    expect(bottom.dataset["prop"]).toBe("innerY");
    expectAt(bottom, {
      left: box.left + border,
      top: box.bottom - border - 6 * zoom,
      width: box.width - 2 * border,
      height: 6 * zoom,
    });
    const right = await edgeOf(host, "inner-right");
    expect(right.dataset["prop"]).toBe("innerX");
    expectAt(right, {
      left: box.right - border - 12 * zoom,
      top: box.top + border,
      width: 12 * zoom,
      height: box.height - 2 * border,
    });
  });
});

describe("Box edges", () => {
  it("are drawn for the selected Block only", async () => {
    const editor = cardEditor();
    const { host } = await mountWith(editor, 1);
    expect(host.querySelector("[data-testid='padding-top']")).toBeNull();

    editor.select(cardId(editor));
    await edgeOf(host, "padding-top");

    editor.select(undefined);
    await vi.waitFor(() => {
      expect(host.querySelector("[data-testid='padding-top']")).toBeNull();
    });
  });

  it("follow a Pending Change, and go back when it is cancelled", async () => {
    const editor = cardEditor();
    const card = cardId(editor);
    editor.select(card);
    const { host } = await mountWith(editor, 1);
    const top = await edgeOf(host, "padding-top");
    await vi.waitFor(() => {
      expect(top.getBoundingClientRect().height).toBeCloseTo(10, 0);
    });

    editor.setPendingChange(card, { paddingTop: 50 });
    await vi.waitFor(async () => {
      const moved = await edgeOf(host, "padding-top");
      expect(moved.getBoundingClientRect().height).toBeCloseTo(50, 0);
    });

    editor.cancelPendingChange();
    await vi.waitFor(async () => {
      const back = await edgeOf(host, "padding-top");
      expect(back.getBoundingClientRect().height).toBeCloseTo(10, 0);
    });
  });

  it("keep two Boxes with the same values on their own elements", async () => {
    const editor = cardEditor({
      paddingTop: 8,
      paddingRight: 8,
      paddingBottom: 8,
      paddingLeft: 8,
      innerY: 8,
      innerX: 8,
    });
    const card = cardId(editor);
    editor.select(card);
    const { host, mounted } = await mountWith(editor, 1);
    const block = drawn(mounted, blockElement(mounted, card));

    const outer = await edgeOf(host, "padding-top");
    const inner = await edgeOf(host, "inner-top");
    await vi.waitFor(() => {
      expect(outer.getBoundingClientRect().top).toBeCloseTo(block.top, 0);
      expect(inner.getBoundingClientRect().top).toBeGreaterThan(block.top + 8);
    });
  });

  it.each([
    ["at the Preset's defaults", {}],
    [
      "with outer padding the same as the room around its label",
      {
        paddingTop: 12,
        paddingRight: 20,
        paddingBottom: 12,
        paddingLeft: 20,
        innerPaddingY: 12,
        innerPaddingX: 20,
      },
    ],
  ])(
    "put a button's outer edge on its outer padding, not the room around its label, %s",
    async (_, props) => {
      const editor = createEditor({
        definitions: createReactEmailPreset(),
        rootType: REACT_EMAIL_ROOT_TYPE,
        createId: sequentialIds("block"),
      });
      editor.insertBlock(
        "button",
        editor.getDocument().root.id,
        undefined,
        props,
      );
      const button = cardId(editor);
      editor.select(button);
      const { host, mounted } = await mountWith(editor, 1);
      const anchor = blockElement(mounted, button).querySelector("a");
      if (!anchor) throw new Error("The button did not render.");
      const label = drawn(mounted, anchor);

      const outer = await edgeOf(host, "padding-top");
      const inner = await edgeOf(host, "inner-top");
      expect(outer.dataset["prop"]).toBe("paddingTop");
      expect(inner.dataset["prop"]).toBe("innerPaddingY");
      await vi.waitFor(() => {
        expect(outer.getBoundingClientRect().bottom).toBeLessThanOrEqual(
          label.top + 0.5,
        );
        expect(inner.getBoundingClientRect().top).toBeCloseTo(label.top, 0);
      });
    },
  );

  it("leave out sides with no phone-only value on the mobile Stage", async () => {
    const editor = createEditor({
      definitions: createReactEmailPreset(),
      rootType: REACT_EMAIL_ROOT_TYPE,
      createId: sequentialIds("block"),
    });
    editor.insertBlock("button", editor.getDocument().root.id);
    editor.select(cardId(editor));
    editor.setStage("mobile");
    const { host } = await mountWith(editor, 1);

    await edgeOf(host, "padding-top");
    expect(host.querySelector("[data-testid='inner-top']")).toBeNull();
  });
});
