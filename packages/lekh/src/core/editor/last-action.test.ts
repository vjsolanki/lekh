import { describe, expect, it } from "vitest";

import {
  createCommands,
  createEditor,
  type Editor,
  type Op,
} from "../../index";
import { definitions, sequentialIds } from "../../testing/blocks";
import { editorFor } from "../../testing/editor";
import { createFakeTextEngine } from "../../testing/text-engine";
import { block, documentOf } from "../../testing/tree";

/** Two text Blocks, `a` and `b`, in an email. */
function twoTexts(): Editor {
  return editorFor(
    documentOf(
      block("email", {}, [
        block("text", { id: "a" }),
        block("text", { id: "b" }),
      ]),
    ),
  );
}

/**
 * The last Action says how it came about and which Blocks it touched, so a
 * Consumer can choose what to animate without diffing Documents.
 */
describe("the last Action", () => {
  it("is nothing before anything has happened", () => {
    expect(editorFor().getLastAction()).toBeUndefined();
  });

  it("names a Block whose props changed", () => {
    const editor = twoTexts();

    editor.setProp("a", "content", "Hello");

    expect(editor.getLastAction()).toEqual({
      via: "api",
      blocks: ["a"],
      inserted: [],
    });
  });

  it("names a new Block as inserted and touched", () => {
    const editor = editorFor();

    const id = editor.insertBlock("text", editor.getDocument().root.id);

    expect(editor.getLastAction()).toEqual({
      via: "api",
      blocks: [id],
      inserted: [id],
    });
  });

  it("names a moved Block", () => {
    const editor = twoTexts();

    editor.moveBlock("b", editor.getDocument().root.id, 0);

    expect(editor.getLastAction()?.blocks).toEqual(["b"]);
  });

  it("takes how a move came about from the caller", () => {
    const editor = twoTexts();

    editor.moveBlock("b", editor.getDocument().root.id, 0, {
      via: "command",
    });

    expect(editor.getLastAction()?.via).toBe("command");
  });

  it("names a removed Block", () => {
    const editor = twoTexts();

    editor.removeBlock("a");

    expect(editor.getLastAction()).toEqual({
      via: "api",
      blocks: ["a"],
      inserted: [],
    });
  });

  it("names each Block once, however many Ops touched it", () => {
    const editor = twoTexts();
    editor.setPendingChange("a", { content: "x", fontSize: 20 });

    editor.commitPendingChange();

    expect(editor.getLastAction()?.blocks).toEqual(["a"]);
  });

  it("counts a selection as an Action that touched nothing", () => {
    const editor = twoTexts();

    editor.select("a");

    expect(editor.getLastAction()).toEqual({
      via: "api",
      blocks: [],
      inserted: [],
    });
  });

  it("takes how a selection came about from the caller", () => {
    const editor = twoTexts();

    editor.select("a", { via: "pointer" });

    expect(editor.getLastAction()?.via).toBe("pointer");
  });

  it("is not a selection that moves nothing", () => {
    const editor = twoTexts();
    editor.select("a", { via: "pointer" });
    const before = editor.getLastAction();

    editor.select("a");

    expect(editor.getLastAction()).toBe(before);
  });

  it("does not count a drag that has not landed", () => {
    const editor = twoTexts();
    editor.select("a");
    const before = editor.getLastAction();

    editor.setPendingChange("a", { content: "x" });

    expect(editor.getLastAction()).toBe(before);
  });

  it("says a Command did what a Command does", () => {
    const editor = twoTexts();
    const commands = createCommands(editor);
    editor.select("a");

    commands.selectNext();
    expect(editor.getLastAction()?.via).toBe("command");

    commands.delete();
    expect(editor.getLastAction()).toEqual({
      via: "command",
      blocks: ["b"],
      inserted: [],
    });
  });

  it("says History did an undo or a redo, however it was asked for", () => {
    const editor = twoTexts();
    const commands = createCommands(editor);
    editor.setProp("b", "content", "Hello");

    editor.undo();
    expect(editor.getLastAction()).toEqual({
      via: "history",
      blocks: ["b"],
      inserted: [],
    });

    commands.redo();
    expect(editor.getLastAction()?.via).toBe("history");
  });

  it("says a peer's Ops came from elsewhere", () => {
    const editor = twoTexts();
    const op: Op = {
      kind: "set-prop",
      origin: "peer",
      blockId: "b",
      prop: "content",
      value: "Hi",
      previousValue: undefined,
    };

    editor.applyExternalOps([op]);

    expect(editor.getLastAction()).toEqual({
      via: "remote",
      blocks: ["b"],
      inserted: [],
    });
  });

  it("names the Block whose text an undo took back", () => {
    const engine = createFakeTextEngine();
    const editor = createEditor({
      definitions,
      rootType: "email",
      createId: sequentialIds(),
      textEngine: engine,
    });
    const id = editor.insertBlock("text", editor.getDocument().root.id) ?? "";
    engine.type(id, "Hello");
    editor.markTextEdit(id);
    editor.select(id);

    editor.undo();

    expect(editor.getLastAction()).toEqual({
      via: "history",
      blocks: [id],
      inserted: [],
    });
  });

  it("is one Action for a placement that inserts and selects", () => {
    const editor = editorFor();
    const heard: unknown[] = [];
    editor.subscribe(() => {
      heard.push(editor.getLastAction());
    });

    const placed = editor.place({ reason: "insert", type: "text" });

    const id = placed.status === "inserted" ? placed.blockId : "";
    expect(heard).toEqual([{ via: "api", blocks: [id], inserted: [id] }]);
  });

  it("does not lend how it came about to an Action a listener starts", () => {
    const editor = twoTexts();
    editor.setProp("a", "content", "Hello");
    editor.subscribe(() => {
      if (editor.getLastAction()?.via === "history") editor.select("b");
    });

    editor.undo();

    expect(editor.getLastAction()).toEqual({
      via: "api",
      blocks: [],
      inserted: [],
    });
  });

  it("is the same object until the next Action", () => {
    const editor = twoTexts();
    editor.select("a");

    expect(editor.getLastAction()).toBe(editor.getLastAction());
  });
});
