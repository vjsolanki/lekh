import { describe, expect, it } from "vitest";

import type { Editor } from "../../index";
import { definitionsWithSeeded } from "../../testing/blocks";
import { editorFor } from "../../testing/editor";
import { block, documentOf } from "../../testing/tree";

/** Two text Blocks, `a` and `b`, and a grid whose structural cell is `cell`. */
function email(): Editor {
  return editorFor(
    documentOf(
      block("email", {}, [
        block("text", { id: "a" }),
        block("text", { id: "b" }),
        block("grid", { id: "grid" }, [block("cell", { id: "cell" })]),
      ]),
    ),
    { definitions: definitionsWithSeeded },
  );
}

/**
 * Hover is editor state, so the Canvas and a Consumer's own tree share it: a
 * tree row lights the Block on the Canvas, and the Canvas lights the row.
 */
describe("hover", () => {
  it("is nothing to begin with", () => {
    expect(email().getHovered()).toBeUndefined();
  });

  it("is the Block it was set to", () => {
    const editor = email();

    editor.hover("a");

    expect(editor.getHovered()).toBe("a");
  });

  it("is cleared with undefined", () => {
    const editor = email();
    editor.hover("a");

    editor.hover(undefined);

    expect(editor.getHovered()).toBeUndefined();
  });

  it("lands where a press would, so a structural Block hovers its parent", () => {
    const editor = email();

    editor.hover("cell");

    expect(editor.getHovered()).toBe("grid");
  });

  it("is nothing on the root, which is the whole email", () => {
    const editor = email();
    editor.hover("a");

    editor.hover(editor.getDocument().root.id);

    expect(editor.getHovered()).toBeUndefined();
  });

  it("refuses a Block that is not in the Document", () => {
    const editor = email();
    editor.hover("a");

    expect(editor.hover("missing")).toBe(false);
    expect(editor.getHovered()).toBe("a");
  });

  it("tells hover listeners when it moves, and only then", () => {
    const editor = email();
    let told = 0;
    editor.subscribeToHover(() => {
      told += 1;
    });

    editor.hover("a");
    editor.hover("a");
    editor.hover("b");
    editor.hover(undefined);

    expect(told).toBe(3);
  });

  it("is not an Action, so change listeners are not told", () => {
    const editor = email();
    editor.select("b");
    const before = editor.getLastAction();
    let changed = 0;
    editor.subscribe(() => {
      changed += 1;
    });

    editor.hover("a");

    expect(changed).toBe(0);
    expect(editor.getLastAction()).toBe(before);
  });

  it("is not History", () => {
    const editor = email();

    editor.hover("a");

    expect(editor.canUndo()).toBe(false);
  });

  it("leaves with the Block it was on", () => {
    const editor = email();
    editor.hover("a");
    let told = 0;
    editor.subscribeToHover(() => {
      told += 1;
    });

    editor.removeBlock("a");

    expect(editor.getHovered()).toBeUndefined();
    expect(told).toBe(1);
  });

  it("is told it left after change listeners, once the Document has settled", () => {
    const editor = email();
    editor.hover("a");
    const heard: string[] = [];
    editor.subscribe(() => {
      heard.push("change");
    });
    editor.subscribeToHover(() => {
      heard.push(editor.getBlock("a") ? "hover, a still there" : "hover");
    });

    editor.removeBlock("a");

    expect(heard).toEqual(["change", "hover"]);
  });

  it("stays on a Block that is still there", () => {
    const editor = email();
    editor.hover("a");

    editor.removeBlock("b");

    expect(editor.getHovered()).toBe("a");
  });
});
