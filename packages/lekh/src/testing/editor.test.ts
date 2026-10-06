import { describe, expect, it } from "vitest";

import { definitionsWithSeeded, email } from "./blocks";
import { editorFor } from "./editor";
import { block, documentOf } from "./tree";

describe("the editor factory", () => {
  it("opens a Document with the test Blocks", () => {
    const editor = editorFor(
      documentOf(
        block("email", { id: "root" }, [
          block("text", { id: "hello", content: "Hi" }),
        ]),
      ),
    );

    expect(editor.getDocument().root.children?.[0]?.id).toBe("hello");
    expect(
      editor.getDefinitions().map((definition) => definition.type),
    ).toEqual(["email", "section", "text", "image"]);
  });

  it("starts from a blank email when given no Document", () => {
    const editor = editorFor();

    expect(editor.getDocument().root.type).toBe("email");
    expect(editor.getDocument().root.children).toEqual([]);
  });

  it("hands out ids a test can predict", () => {
    const editor = editorFor();
    const root = editor.getDocument().root.id;

    expect(editor.insertBlock("text", root)).toBe("id-2");
    expect(editor.insertBlock("text", root)).toBe("id-3");
  });

  it("takes any option the editor takes, over its own", () => {
    const editor = editorFor(undefined, {
      definitions: definitionsWithSeeded,
      origin: "tab-a",
    });
    const heard: string[] = [];
    editor.onOp((op) => {
      heard.push(op.origin);
    });

    const grid = editor.insertBlock("grid", editor.getDocument().root.id);

    expect(grid).toBeDefined();
    expect(heard[0]).toBe("tab-a");
  });

  it("follows the Document's root type", () => {
    const editor = editorFor(documentOf(block("letter", {}, [])), {
      definitions: [{ ...email, type: "letter" }],
    });

    expect(editor.getDocument().root.type).toBe("letter");
  });
});
