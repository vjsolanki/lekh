import { beforeEach, describe, expect, it, vi } from "vitest";

import { createEditor, type Editor, type Op } from "../../index";
import { definitions, sequentialIds } from "../../testing/blocks";

function recordOps(editor: Editor): Op[] {
  const ops: Op[] = [];
  editor.onOp((op) => {
    ops.push(op);
  });
  return ops;
}

describe("the Op stream", () => {
  let editor: Editor;
  let root: string;

  beforeEach(() => {
    editor = createEditor({
      definitions,
      rootType: "email",
      createId: sequentialIds(),
    });
    root = editor.getDocument().root.id;
  });

  it("reports every change as a typed, serialisable Op", () => {
    const ops = recordOps(editor);
    const id = editor.insertBlock("text", root) ?? "";
    editor.setProp(id, "fontSize", 20);
    editor.removeBlock(id);

    expect(ops.map((op) => op.kind)).toEqual(["insert", "set-prop", "remove"]);
    expect(JSON.parse(JSON.stringify(ops))).toEqual(ops);
  });

  it("stamps each Op with its origin", () => {
    const editorWithOrigin = createEditor({
      definitions,
      rootType: "email",
      createId: sequentialIds(),
      origin: "tab-a",
    });
    const ops = recordOps(editorWithOrigin);
    editorWithOrigin.insertBlock(
      "text",
      editorWithOrigin.getDocument().root.id,
    );

    expect(ops[0]?.origin).toBe("tab-a");
  });

  it("defaults the origin to local", () => {
    const ops = recordOps(editor);
    editor.insertBlock("text", root);

    expect(ops[0]?.origin).toBe("local");
  });

  it("settles the Document before any listener runs", () => {
    let seen: number | undefined;
    editor.onOp(() => {
      seen = editor.getDocument().root.children?.length;
    });
    editor.insertBlock("text", root);

    expect(seen).toBe(1);
  });

  it("runs every Op subscriber before any change subscriber", () => {
    const order: string[] = [];
    editor.onOp(() => order.push("op"));
    editor.subscribe(() => order.push("change"));

    editor.applyExternalOps([
      {
        kind: "insert",
        origin: "tab-b",
        parentId: root,
        index: 0,
        block: { id: "one", type: "text", props: {} },
      },
      {
        kind: "insert",
        origin: "tab-b",
        parentId: root,
        index: 1,
        block: { id: "two", type: "text", props: {} },
      },
    ]);

    // Both patches are written before anything reacts to the state they made.
    expect(order).toEqual(["op", "op", "change"]);
  });

  it("records the action in history before any listener runs", () => {
    let couldUndo: boolean | undefined;
    editor.subscribe(() => {
      couldUndo = editor.canUndo();
    });
    editor.insertBlock("text", root);

    expect(couldUndo).toBe(true);
  });

  it("announces a change once per action", () => {
    const listener = vi.fn();
    editor.subscribe(listener);
    editor.insertBlock("text", root);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("announces once for a placement, which is an insertion and a selection", () => {
    const listener = vi.fn();
    editor.subscribe(listener);

    expect(editor.place({ reason: "insert", type: "text" }).status).toBe(
      "inserted",
    );

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("asks for a reveal after the change listeners for the same action", () => {
    const order: string[] = [];
    editor.subscribe(() => order.push("change"));
    editor.onReveal(() => order.push("reveal"));

    // No target, so the Author did not choose the position and is taken to it.
    editor.place({ reason: "insert", type: "text" });

    expect(order).toEqual(["change", "reveal"]);
  });

  it("never shows a subscriber a state no action produced", () => {
    // Halfway through a placement the Block is in the Document and the old
    // selection still stands. Nobody is woken there.
    const first = editor.insertBlock("text", root) ?? "";
    editor.select(first);

    const seen: (string | undefined)[] = [];
    editor.subscribe(() => seen.push(editor.getSelection()));

    const placed = editor.place({ reason: "insert", type: "text" });
    expect(placed.status).toBe("inserted");
    expect(seen).toEqual([
      placed.status === "inserted" ? placed.blockId : undefined,
    ]);
  });

  it("stops calling a listener that unsubscribed", () => {
    const listener = vi.fn();
    editor.subscribe(listener)();
    editor.insertBlock("text", root);

    expect(listener).not.toHaveBeenCalled();
  });

  it("emits no Op for a refused operation", () => {
    const ops = recordOps(editor);

    expect(editor.setProp("nope", "fontSize", 20)).toBe(false);
    expect(editor.moveBlock("nope", root, 0)).toBe(false);
    expect(ops).toEqual([]);
  });
});

describe("undo and redo", () => {
  let editor: Editor;
  let root: string;

  beforeEach(() => {
    editor = createEditor({
      definitions,
      rootType: "email",
      createId: sequentialIds(),
    });
    root = editor.getDocument().root.id;
  });

  it("reverts exactly the last action", () => {
    editor.insertBlock("text", root);
    editor.insertBlock("image", root);

    expect(editor.undo()).toBe(true);
    expect(
      editor.getDocument().root.children?.map((child) => child.type),
    ).toEqual(["text"]);
  });

  it("reapplies what was just undone", () => {
    const id = editor.insertBlock("text", root) ?? "";
    editor.setProp(id, "fontSize", 32);
    editor.undo();

    expect(editor.redo()).toBe(true);
    expect(editor.getBlock(id)?.props["fontSize"]).toBe(32);
  });

  it("restores a deleted Block with everything under it", () => {
    const sectionId = editor.insertBlock("section", root) ?? "";
    const textId = editor.insertBlock("text", sectionId) ?? "";
    editor.removeBlock(sectionId);
    editor.undo();

    expect(editor.getBlock(textId)).toBeDefined();
  });

  it("puts a moved Block back where it was", () => {
    editor.insertBlock("text", root);
    editor.insertBlock("image", root);
    const moved = editor.insertBlock("section", root) ?? "";
    editor.moveBlock(moved, root, 0);
    editor.undo();

    expect(
      editor.getDocument().root.children?.map((child) => child.type),
    ).toEqual(["text", "image", "section"]);
  });

  it("puts a Block moved between parents back where it was", () => {
    const sectionId = editor.insertBlock("section", root) ?? "";
    const textId = editor.insertBlock("text", root) ?? "";
    editor.moveBlock(textId, sectionId, 0);
    editor.undo();

    expect(
      editor.getDocument().root.children?.map((child) => child.id),
    ).toEqual([sectionId, textId]);
  });

  it("unsets a prop that had no stored value before", () => {
    const id = editor.insertBlock("text", root) ?? "";
    editor.setProp(id, "fontSize", 32);
    editor.undo();

    expect(editor.getBlock(id)?.props).toEqual({});
  });

  it("reports whether there is anything to undo or redo", () => {
    expect(editor.canUndo()).toBe(false);
    expect(editor.canRedo()).toBe(false);

    editor.insertBlock("text", root);
    expect(editor.canUndo()).toBe(true);

    editor.undo();
    expect(editor.canUndo()).toBe(false);
    expect(editor.canRedo()).toBe(true);
  });

  it("drops the redo stack once a new action happens", () => {
    editor.insertBlock("text", root);
    editor.undo();
    editor.insertBlock("image", root);

    expect(editor.canRedo()).toBe(false);
  });

  it("does nothing when there is nothing to undo", () => {
    expect(editor.undo()).toBe(false);
    expect(editor.redo()).toBe(false);
  });

  it("emits the Ops it applies, so a Consumer can persist them too", () => {
    editor.insertBlock("text", root);
    const ops = recordOps(editor);
    editor.undo();

    expect(ops.map((op) => op.kind)).toEqual(["remove"]);
  });
});

describe("Ops applied from outside", () => {
  let editor: Editor;
  let root: string;

  beforeEach(() => {
    editor = createEditor({
      definitions,
      rootType: "email",
      createId: sequentialIds(),
    });
    root = editor.getDocument().root.id;
  });

  it("changes the Document", () => {
    editor.applyExternalOps([
      {
        kind: "insert",
        origin: "tab-b",
        parentId: root,
        index: 0,
        block: { id: "remote", type: "text", props: {} },
      },
    ]);

    expect(editor.getBlock("remote")).toBeDefined();
  });

  it("stays out of the local undo stack", () => {
    editor.applyExternalOps([
      {
        kind: "insert",
        origin: "tab-b",
        parentId: root,
        index: 0,
        block: { id: "remote", type: "text", props: {} },
      },
    ]);

    // An Author must never undo a change they did not make.
    expect(editor.canUndo()).toBe(false);
  });

  it("keeps its origin, so a Consumer can filter their own echoes", () => {
    const ops = recordOps(editor);
    editor.applyExternalOps([
      {
        kind: "insert",
        origin: "tab-b",
        parentId: root,
        index: 0,
        block: { id: "remote", type: "text", props: {} },
      },
    ]);

    expect(ops[0]?.origin).toBe("tab-b");
  });

  it("reconciles selection when it removes the selected Block", () => {
    const id = editor.insertBlock("text", root) ?? "";
    editor.select(id);

    editor.applyExternalOps([
      {
        kind: "remove",
        origin: "tab-b",
        parentId: root,
        index: 0,
        block: editor.getBlock(id) ?? { id, type: "text", props: {} },
      },
    ]);

    expect(editor.getSelection()).toBeUndefined();
    expect(editor.getControls()[0]?.blockId).toBe(root);
  });

  it("is left alone by our undo, which steps over to the action before", () => {
    const id = editor.insertBlock("text", root) ?? "";
    editor.setProp(id, "fontSize", 20);
    editor.applyExternalOps([
      {
        kind: "set-prop",
        origin: "tab-b",
        blockId: id,
        prop: "fontSize",
        value: 24,
        previousValue: 20,
      },
    ]);

    // Our 20 is gone, so there is nothing of ours to take back on that prop.
    // The insertion before it still is.
    expect(editor.undo()).toBe(true);
    expect(editor.getBlock(id)).toBeUndefined();
    expect(editor.redo()).toBe(true);
    expect(editor.getBlock(id)?.props["fontSize"]).toBe(24);
    expect(editor.canRedo()).toBe(false);
  });

  it("removing a Block of ours leaves nothing to undo or redo for it", () => {
    const id = editor.insertBlock("text", root) ?? "";
    editor.applyExternalOps([
      {
        kind: "remove",
        origin: "tab-b",
        parentId: root,
        index: 0,
        block: editor.getBlock(id) ?? { id, type: "text", props: {} },
      },
    ]);

    // A redo would bring back what the peer took away.
    expect(editor.canUndo()).toBe(false);
    expect(editor.undo()).toBe(false);
    expect(editor.canRedo()).toBe(false);
    expect(editor.getBlock(id)).toBeUndefined();
  });

  it("resolves conflicts last-write-wins in arrival order", () => {
    const id = editor.insertBlock("text", root) ?? "";

    editor.applyExternalOps([
      {
        kind: "set-prop",
        origin: "tab-b",
        blockId: id,
        prop: "fontSize",
        value: 18,
        previousValue: undefined,
      },
      {
        kind: "set-prop",
        origin: "tab-c",
        blockId: id,
        prop: "fontSize",
        value: 24,
        previousValue: 18,
      },
    ]);

    expect(editor.getBlock(id)?.props["fontSize"]).toBe(24);
  });
});
