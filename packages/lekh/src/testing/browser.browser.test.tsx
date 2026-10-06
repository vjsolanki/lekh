import { describe, expect, it, vi } from "vitest";

import { Canvas, EditorProvider } from "../canvas";
import { defineBlock } from "../index";
import {
  afterAFrame,
  blockElement,
  centreOf,
  centreOfBlock,
  dragPointer,
  mount,
  pathBetween,
  pointOnBlock,
  whenRendered,
} from "./browser";
import { editorFor } from "./editor";
import { block, documentOf } from "./tree";

/**
 * Plain elements of a fixed height, which a browser lays out as written. The
 * test Blocks are table markup for the render path, and a `<p>` in a `<tbody>`
 * is not something a Canvas test should have to read past.
 */
const definitions = [
  defineBlock({
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
      <p style={{ margin: 0, height: 60, lineHeight: "60px" }}>
        {props.content}
      </p>
    ),
  }),
];

const threeTexts = () =>
  editorFor(
    documentOf(
      block("email", { id: "root" }, [
        block("text", { id: "one", content: "One" }),
        block("text", { id: "two", content: "Two" }),
        block("text", { id: "three", content: "Three" }),
      ]),
    ),
    { definitions },
  );

const documentOrder = (editor: ReturnType<typeof editorFor>) =>
  (editor.getDocument().root.children ?? []).map((child) => child.id);

describe("the browser helpers", () => {
  it("mount a Canvas and wait until its Blocks are drawn", async () => {
    const host = mount(
      <EditorProvider editor={threeTexts()}>
        <Canvas />
      </EditorProvider>,
    );

    const mounted = await whenRendered(host);

    expect(host.isConnected).toBe(true);
    expect(blockElement(mounted, "two").textContent).toBe("Two");
    expect(() => blockElement(mounted, "four")).toThrow(/No element/u);
  });

  it("aim at the centre of a Block, across the frame's offset", async () => {
    const host = mount(
      <EditorProvider editor={threeTexts()}>
        <Canvas />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);

    const centre = centreOfBlock(mounted, "two");
    const frame = mounted.frame.getBoundingClientRect();
    const hit = mounted.frameDocument.elementFromPoint(
      centre.x - frame.left,
      centre.y - frame.top,
    );

    expect(hit?.closest<HTMLElement>("[data-block-id]")?.dataset.blockId).toBe(
      "two",
    );
    expect(centreOf(mounted.frame).x).toBeCloseTo(
      frame.left + frame.width / 2,
      5,
    );
  });

  it("drive a real pointer along a path that moves a Block", async () => {
    const editor = threeTexts();
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);

    await dragPointer(
      pathBetween(
        centreOfBlock(mounted, "three"),
        pointOnBlock(mounted, "one", 0.2),
      ),
    );

    await vi.waitFor(() => {
      expect(documentOrder(editor)).toEqual(["three", "one", "two"]);
    });
  });

  it("let a gesture that changes nothing have its frame", async () => {
    const editor = threeTexts();
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);

    // Dropped back where it started.
    const centre = centreOfBlock(mounted, "two");
    await dragPointer(pathBetween(centre, centre));
    await afterAFrame();

    expect(documentOrder(editor)).toEqual(["one", "two", "three"]);
  });

  describe("cleaning up", () => {
    let earlier: HTMLElement | undefined;

    it("mount a host for one test", () => {
      earlier = mount(<p>Here</p>);
      expect(earlier.isConnected).toBe(true);
    });

    it("and remove it when that test ends", () => {
      // Fails, rather than passing on nothing, if run without the test above.
      expect(earlier).toBeDefined();
      expect(earlier?.isConnected).toBe(false);
    });
  });
});
