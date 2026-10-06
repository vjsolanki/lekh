import { beforeEach, describe, expect, it } from "vitest";

import {
  createCommands,
  createEditor,
  type Commands,
  type Editor,
} from "../../index";
import {
  definitions,
  definitionsWithRequired,
  definitionsWithSeeded,
  sequentialIds,
} from "../../testing/blocks";
import { editorFor } from "../../testing/editor";
import { block, documentOf } from "../../testing/tree";

/**
 * Commands are the named actions every keybinding resolves to, and every one
 * of them is also a method a Consumer can call from their own button. They are
 * pure editor manipulation, so they are tested here rather than in a browser.
 */
describe("commands", () => {
  let editor: Editor;
  let commands: Commands;
  let root: string;

  beforeEach(() => {
    editor = createEditor({
      definitions,
      rootType: "email",
      createId: sequentialIds(),
    });
    commands = createCommands(editor);
    root = editor.getDocument().root.id;
  });

  const childTypes = (): readonly string[] =>
    (editor.getDocument().root.children ?? []).map((child) => child.type);

  it("undoes and redoes the last action", () => {
    editor.insertBlock("text", root);
    expect(commands.undo()).toBe(true);
    expect(childTypes()).toEqual([]);

    expect(commands.redo()).toBe(true);
    expect(childTypes()).toEqual(["text"]);
  });

  it("deletes the selected Block", () => {
    const id = editor.insertBlock("text", root) ?? "";
    editor.select(id);

    expect(commands.delete()).toBe(true);
    expect(childTypes()).toEqual([]);
  });

  it("refuses to delete when nothing is selected", () => {
    editor.insertBlock("text", root);

    expect(commands.delete()).toBe(false);
    expect(childTypes()).toEqual(["text"]);
  });

  it("duplicates the selected Block in place", () => {
    const id = editor.insertBlock("text", root) ?? "";
    editor.insertBlock("image", root);
    editor.select(id);

    expect(commands.duplicate()).toBe(true);
    expect(childTypes()).toEqual(["text", "text", "image"]);
  });

  it("moves the selected Block towards the start of its parent", () => {
    editor.insertBlock("text", root);
    const id = editor.insertBlock("image", root) ?? "";
    editor.select(id);

    expect(commands.moveUp()).toBe(true);
    expect(childTypes()).toEqual(["image", "text"]);
  });

  it("moves the selected Block towards the end of its parent", () => {
    const id = editor.insertBlock("text", root) ?? "";
    editor.insertBlock("image", root);
    editor.select(id);

    expect(commands.moveDown()).toBe(true);
    expect(childTypes()).toEqual(["image", "text"]);
  });

  it("refuses to move past the ends of the parent", () => {
    const id = editor.insertBlock("text", root) ?? "";
    editor.insertBlock("image", root);
    editor.select(id);

    expect(commands.moveUp()).toBe(false);
    expect(commands.moveDown()).toBe(true);
    expect(commands.moveDown()).toBe(false);
    expect(childTypes()).toEqual(["image", "text"]);
  });

  it("refuses to move when nothing is selected", () => {
    editor.insertBlock("text", root);
    editor.insertBlock("image", root);

    expect(commands.moveUp()).toBe(false);
    expect(commands.moveDown()).toBe(false);
  });

  it("leaves the Block's text, keeping the Block selected", () => {
    const id = editor.insertBlock("text", root) ?? "";
    editor.edit(id);

    expect(commands.stopEditing()).toBe(true);

    expect(editor.getEditing()).toBeUndefined();
    expect(editor.getSelection()).toBe(id);
  });

  it("refuses to leave text nobody is in", () => {
    const id = editor.insertBlock("text", root) ?? "";
    editor.select(id);

    // Refused rather than quietly true, so a Consumer's own Escape handling
    // can tell that the keystroke was theirs to use.
    expect(commands.stopEditing()).toBe(false);
  });

  it("leaves no undo entry behind a refused command", () => {
    editor.insertBlock("text", root);
    expect(commands.delete()).toBe(false);

    expect(commands.undo()).toBe(true);
    expect(childTypes()).toEqual([]);
  });

  describe("can", () => {
    it("says no to everything on an empty email", () => {
      expect(commands.can.undo()).toBe(false);
      expect(commands.can.redo()).toBe(false);
      expect(commands.can.delete()).toBe(false);
      expect(commands.can.duplicate()).toBe(false);
      expect(commands.can.moveUp()).toBe(false);
      expect(commands.can.moveDown()).toBe(false);
      expect(commands.can.stopEditing()).toBe(false);
      expect(commands.can.stepOut()).toBe(false);
      expect(commands.can.selectFirstChild()).toBe(false);
      expect(commands.can.selectPrevious()).toBe(false);
      expect(commands.can.selectNext()).toBe(false);
    });

    it("answers undo and redo as the editor does", () => {
      editor.insertBlock("text", root);
      expect(commands.can.undo()).toBe(true);
      expect(commands.can.redo()).toBe(false);

      commands.undo();
      expect(commands.can.undo()).toBe(false);
      expect(commands.can.redo()).toBe(true);
    });

    it("says no to delete and duplicate with nothing selected", () => {
      editor.insertBlock("text", root);

      expect(commands.can.delete()).toBe(false);
      expect(commands.can.duplicate()).toBe(false);
    });

    it("says yes to delete and duplicate on a selected Block", () => {
      editor.select(editor.insertBlock("text", root));

      expect(commands.can.delete()).toBe(true);
      expect(commands.can.duplicate()).toBe(true);
    });

    it("says no to delete on a Block that may not be deleted", () => {
      editor = createEditor({
        definitions: definitionsWithRequired({ deletable: false }),
        rootType: "email",
      });
      commands = createCommands(editor);
      const id = editor.insertBlock(
        "unsubscribe",
        editor.getDocument().root.id,
      );
      editor.select(id);
      expect(editor.getSelection()).toBeDefined();

      expect(commands.can.delete()).toBe(false);
      expect(commands.delete()).toBe(false);
    });

    it("says no to duplicate where the parent is full", () => {
      const section = editor.insertBlock("section", root) ?? "";
      const id = editor.insertBlock("text", section);
      editor.insertBlock("image", section);
      editor.select(id);
      expect(editor.getSelection()).toBe(id);

      expect(commands.can.duplicate()).toBe(false);
      expect(commands.duplicate()).toBe(false);
    });

    it("says no to moveUp on a first child and moveDown on a last", () => {
      const first = editor.insertBlock("text", root);
      const last = editor.insertBlock("image", root);

      editor.select(first);
      expect(commands.can.moveUp()).toBe(false);
      expect(commands.can.moveDown()).toBe(true);

      editor.select(last);
      expect(commands.can.moveUp()).toBe(true);
      expect(commands.can.moveDown()).toBe(false);
    });

    it("says no to stopEditing when nobody is typing", () => {
      const id = editor.insertBlock("text", root) ?? "";
      editor.select(id);
      expect(commands.can.stopEditing()).toBe(false);

      editor.edit(id);
      expect(commands.can.stopEditing()).toBe(true);
    });

    it("changes nothing by asking", () => {
      editor.select(editor.insertBlock("text", root));
      const document = editor.getDocument();

      commands.can.delete();
      commands.can.duplicate();
      commands.can.moveDown();

      expect(editor.getDocument()).toBe(document);
      expect(commands.can.redo()).toBe(false);
    });
  });

  /**
   * Esc, Enter and the arrows move the selection through the tree. A
   * Structural Block is never landed on: it is reached through its owner
   * (ADR-0031), so a step treats a grid's cells as if their Blocks were the
   * grid's own.
   */
  describe("stepping through the tree", () => {
    const stepping = (): void => {
      editor = editorFor(
        documentOf(
          block("email", {}, [
            block("section", {}, [block("text"), block("image")]),
            block("grid", {}, [
              block("cell", {}, [block("text"), block("image")]),
              block("cell", {}, [block("image")]),
            ]),
            block("text"),
          ]),
        ),
        { definitions: definitionsWithSeeded },
      );
      commands = createCommands(editor);
    };

    it("steps out of the text first, keeping the Block", () => {
      stepping();
      editor.edit("text-1");

      expect(commands.can.stepOut()).toBe(true);
      expect(commands.stepOut()).toBe(true);
      expect(editor.getEditing()).toBeUndefined();
      expect(editor.getSelection()).toBe("text-1");
    });

    it("steps out to the parent, then to nothing, never the root", () => {
      stepping();
      editor.select("text-1");

      expect(commands.stepOut()).toBe(true);
      expect(editor.getSelection()).toBe("section-1");

      expect(commands.stepOut()).toBe(true);
      expect(editor.getSelection()).toBeUndefined();

      expect(commands.can.stepOut()).toBe(false);
      expect(commands.stepOut()).toBe(false);
    });

    it("steps out of a Block in a cell to the grid, not the cell", () => {
      stepping();
      editor.select("image-2");

      expect(commands.stepOut()).toBe(true);
      expect(editor.getSelection()).toBe("grid-1");
    });

    it("steps into the first child", () => {
      stepping();
      editor.select("section-1");

      expect(commands.can.selectFirstChild()).toBe(true);
      expect(commands.selectFirstChild()).toBe(true);
      expect(editor.getSelection()).toBe("text-1");
    });

    it("steps into the first Block of the first cell", () => {
      stepping();
      editor.select("grid-1");

      expect(commands.selectFirstChild()).toBe(true);
      expect(editor.getSelection()).toBe("text-2");
    });

    it("steps into the email's first Block with nothing selected", () => {
      stepping();

      expect(commands.selectFirstChild()).toBe(true);
      expect(editor.getSelection()).toBe("section-1");
    });

    it("starts typing in a text Block with no children", () => {
      stepping();
      editor.select("text-1");

      expect(commands.can.selectFirstChild()).toBe(true);
      expect(commands.selectFirstChild()).toBe(true);
      expect(editor.getEditing()).toBe("text-1");

      expect(commands.can.selectFirstChild()).toBe(false);
      expect(commands.selectFirstChild()).toBe(false);
    });

    it("refuses to step into a Block with no children and no text", () => {
      stepping();
      editor.select("image-1");

      expect(commands.can.selectFirstChild()).toBe(false);
      expect(commands.selectFirstChild()).toBe(false);
      expect(editor.getSelection()).toBe("image-1");
    });

    it("moves between siblings, stopping at the ends", () => {
      stepping();
      editor.select("section-1");

      expect(commands.can.selectPrevious()).toBe(false);
      expect(commands.selectNext()).toBe(true);
      expect(editor.getSelection()).toBe("grid-1");
      expect(commands.selectNext()).toBe(true);
      expect(editor.getSelection()).toBe("text-3");

      expect(commands.can.selectNext()).toBe(false);
      expect(commands.selectNext()).toBe(false);
      expect(commands.selectPrevious()).toBe(true);
      expect(editor.getSelection()).toBe("grid-1");
    });

    it("walks a grid's Blocks across its cells", () => {
      stepping();
      editor.select("image-2");

      expect(commands.selectNext()).toBe(true);
      expect(editor.getSelection()).toBe("image-3");
      expect(commands.can.selectNext()).toBe(false);

      expect(commands.selectPrevious()).toBe(true);
      expect(commands.selectPrevious()).toBe(true);
      expect(editor.getSelection()).toBe("text-2");
    });

    it("refuses to move between siblings with nothing selected", () => {
      stepping();

      expect(commands.can.selectNext()).toBe(false);
      expect(commands.selectNext()).toBe(false);
      expect(commands.can.selectPrevious()).toBe(false);
    });
  });
});
