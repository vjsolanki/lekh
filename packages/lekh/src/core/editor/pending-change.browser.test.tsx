import { describe, expect, it, vi } from "vitest";

import { Canvas, EditorProvider } from "../../canvas";
import { createEditor, defineBlock, type BlockDefinition } from "../../index";
import { sequentialIds } from "../../testing/blocks";
import { blockElement, mount, whenRendered } from "../../testing/browser";

const definitions: readonly BlockDefinition[] = [
  defineBlock({
    type: "email",
    label: "Email",
    accepts: ["text"],
    schema: {},
    render: ({ children }) => <div>{children}</div>,
  }),
  defineBlock<{ color: string }>({
    type: "text",
    label: "Text",
    schema: {
      color: { kind: "color", label: "Color", defaultValue: "#ff0000" },
    },
    render: ({ props }) => <p style={{ color: props.color }}>Text</p>,
  }),
];

/** Wait until the frame draws the Block in this colour. */
async function whenColor(
  host: HTMLElement,
  blockId: string,
  color: string,
): Promise<void> {
  const mounted = await whenRendered(host);
  await vi.waitFor(() => {
    // The attribute rather than `element.style`: the element belongs to the
    // frame's realm.
    const style = blockElement(mounted, blockId).getAttribute("style");
    if (style !== `color: ${color};`) {
      throw new Error(`Drawn as ${String(style)}, not ${color}.`);
    }
  });
}

// ADR-0032: the Canvas shows what the Author is dragging, not only what is
// stored.
describe("the Canvas during an Inspector drag", () => {
  it("shows the Pending Change, then the saved value after cancel", async () => {
    const editor = createEditor({
      definitions,
      rootType: "email",
      createId: sequentialIds(),
    });
    const text =
      editor.insertBlock("text", editor.getDocument().root.id, 0, {
        color: "#ff0000",
      }) ?? "";

    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas />
      </EditorProvider>,
    );
    await whenColor(host, text, "rgb(255, 0, 0)");

    editor.setPendingChange(text, { color: "#0000ff" });
    await whenColor(host, text, "rgb(0, 0, 255)");
    expect(editor.getBlock(text)?.props["color"]).toBe("#ff0000");

    editor.cancelPendingChange();
    await whenColor(host, text, "rgb(255, 0, 0)");
  });
});
