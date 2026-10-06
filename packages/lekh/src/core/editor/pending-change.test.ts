import { beforeEach, describe, expect, it } from "vitest";

import { createEditor, type Editor, type Op } from "../../index";
import {
  definitions,
  definitionsDividing,
  sequentialIds,
} from "../../testing/blocks";

// ADR-0032: while an Author drags, the value is shown and not stored.
describe("a Pending Change", () => {
  let editor: Editor;
  let text: string;
  let ops: Op[];

  /** The selected text Block's font size control, as an Inspector reads it. */
  const fontSize = () => {
    const control = editor
      .getControls()
      .find((candidate) => candidate.name === "fontSize");
    if (!control) throw new Error("No font size control.");
    return control;
  };

  const shownFontSize = () =>
    editor
      .getDocumentWithPendingChange()
      .root.children?.find((block) => block.id === text)?.props["fontSize"];

  beforeEach(() => {
    editor = createEditor({
      definitions,
      rootType: "email",
      createId: sequentialIds(),
    });
    text = editor.insertBlock("text", editor.getDocument().root.id) ?? "";
    editor.select(text);
    ops = [];
    editor.onOp((op) => {
      ops.push(op);
    });
  });

  it("shows the dragged value without storing it", () => {
    const saved = editor.getDocument();
    const changes: string[] = [];
    editor.subscribe(() => {
      changes.push("change");
    });

    fontSize().preview(20);
    fontSize().preview(24);

    expect(shownFontSize()).toBe(24);
    expect(editor.getDocument()).toBe(saved);
    expect(ops).toEqual([]);
    expect(changes).toEqual([]);
  });

  it("tells pending listeners on open, move, commit and cancel", () => {
    let told = 0;
    editor.subscribeToPendingChange(() => {
      told += 1;
    });

    fontSize().preview(20);
    fontSize().preview(24);
    fontSize().commit();
    fontSize().preview(30);
    fontSize().cancel();

    expect(told).toBe(5);
  });

  it("writes one Op and one undo step on commit", () => {
    const changes: string[] = [];
    editor.subscribe(() => {
      changes.push("change");
    });
    const before = editor.getBlock(text)?.props["fontSize"];

    fontSize().preview(20);
    fontSize().preview(22);
    fontSize().preview(24);
    fontSize().commit();

    expect(ops).toEqual([
      {
        kind: "set-prop",
        origin: "local",
        blockId: text,
        prop: "fontSize",
        value: 24,
        previousValue: before,
      },
    ]);
    expect(changes).toEqual(["change"]);
    expect(editor.getBlock(text)?.props["fontSize"]).toBe(24);
    expect(editor.getPendingChange()).toBeUndefined();

    editor.undo();
    expect(editor.getBlock(text)?.props["fontSize"]).toBe(before);
  });

  it("commits the value it was given", () => {
    fontSize().preview(20);
    fontSize().commit(26);

    expect(editor.getBlock(text)?.props["fontSize"]).toBe(26);
    expect(ops).toHaveLength(1);
  });

  it("keeps a drag on another prop as its own step when committed with a value", () => {
    const other =
      editor.insertBlock("text", editor.getDocument().root.id) ?? "";
    editor.setPendingChange(other, { fontSize: 30 });
    ops = [];

    fontSize().commit(26);

    expect(ops).toMatchObject([
      { blockId: other, value: 30 },
      { blockId: text, value: 26 },
    ]);
    editor.undo();
    expect(editor.getBlock(other)?.props["fontSize"]).toBe(30);
  });

  it("is a set when committed with a value and nothing pending", () => {
    fontSize().commit(26);

    expect(editor.getBlock(text)?.props["fontSize"]).toBe(26);
    expect(ops).toHaveLength(1);
  });

  it("reads the previous value when it commits, not when it opened", () => {
    fontSize().preview(20);
    // The stored value moves under the drag, the way a peer's edit lands.
    editor.applyExternalOps([
      {
        kind: "set-prop",
        origin: "peer",
        blockId: text,
        prop: "fontSize",
        value: 40,
        previousValue: undefined,
      },
    ]);
    ops = [];
    editor.commitPendingChange();

    expect(ops).toMatchObject([{ value: 20, previousValue: 40 }]);
  });

  it("writes nothing when the drag ends where it began", () => {
    editor.setProp(text, "fontSize", 18);
    ops = [];
    const saved = editor.getDocument();
    fontSize().preview(20);
    fontSize().preview(18);

    expect(editor.commitPendingChange()).toBe(true);
    expect(ops).toEqual([]);
    expect(editor.getDocument()).toBe(saved);
    // One undo takes back the set before the drag: the drag left no entry.
    editor.undo();
    expect(editor.getBlock(text)?.props["fontSize"]).toBeUndefined();
  });

  it("leaves the Document, the Ops and the History alone on cancel", () => {
    const saved = editor.getDocument();
    const undoable = editor.canUndo();
    fontSize().preview(20);
    fontSize().cancel();

    expect(editor.getDocument()).toBe(saved);
    expect(editor.getDocumentWithPendingChange()).toBe(saved);
    expect(ops).toEqual([]);
    expect(editor.canUndo()).toBe(undoable);
    editor.undo();
    // The undo took back the insertion, not a drag that never happened.
    expect(editor.getBlock(text)).toBeUndefined();
  });

  it("keeps the saved value on the control during a drag", () => {
    const controls = editor.getControls();
    fontSize().preview(20);

    expect(editor.getControls()).toBe(controls);
    expect(fontSize().value).toBe(14);
  });

  it("is a stable snapshot of the Block and its Ops", () => {
    expect(editor.getPendingChange()).toBeUndefined();

    fontSize().preview(20);
    const pending = editor.getPendingChange();

    expect(pending).toEqual({
      blockId: text,
      ops: [
        {
          kind: "set-prop",
          origin: "local",
          blockId: text,
          prop: "fontSize",
          value: 20,
          previousValue: undefined,
        },
      ],
    });
    expect(editor.getPendingChange()).toBe(pending);
    // The same value again moves nothing.
    fontSize().preview(20);
    expect(editor.getPendingChange()).toBe(pending);
    expect(editor.getDocumentWithPendingChange()).toBe(
      editor.getDocumentWithPendingChange(),
    );
  });

  it("is the saved Document when nothing is pending", () => {
    expect(editor.getDocumentWithPendingChange()).toBe(editor.getDocument());
  });

  it("announces a commit in order", () => {
    const heard: string[] = [];
    editor.onOp(() => {
      heard.push(`op:${String(editor.getBlock(text)?.props["fontSize"])}`);
    });
    editor.subscribe(() => {
      heard.push("change");
    });
    editor.subscribeToPendingChange(() => {
      heard.push(`pending:${String(editor.getPendingChange() !== undefined)}`);
    });
    fontSize().preview(20);
    heard.length = 0;

    fontSize().commit();

    // The Document has settled and the Pending Change is gone before anyone
    // is told.
    expect(heard).toEqual(["op:20", "change", "pending:false"]);
  });

  it("refuses what a set would refuse, and opens nothing", () => {
    expect(editor.setPendingChange("no-such-block", { fontSize: 20 })).toBe(
      false,
    );
    expect(editor.setPendingChange(text, { noSuchProp: 20 })).toBe(false);

    editor.setStage("mobile");
    // Rich text has no mobile life, so there is no override to drag.
    expect(editor.setPendingChange(text, { content: "Hi" })).toBe(false);

    expect(editor.getPendingChange()).toBeUndefined();
  });

  it("writes a Mobile Override when committed on the mobile Stage", () => {
    editor.setStage("mobile");
    fontSize().preview(12);
    fontSize().commit();

    expect(editor.getBlock(text)).toMatchObject({
      props: {},
      mobile: { fontSize: 12 },
    });
    expect(ops).toMatchObject([{ stage: "mobile", value: 12 }]);
  });

  it("shows a mobile drag on the mobile value", () => {
    editor.setStage("mobile");
    fontSize().preview(12);

    expect(
      editor
        .getDocumentWithPendingChange()
        .root.children?.find((block) => block.id === text)?.mobile,
    ).toEqual({ fontSize: 12 });
  });

  it("returns false from commit and cancel when nothing is pending", () => {
    expect(editor.commitPendingChange()).toBe(false);
    expect(editor.cancelPendingChange()).toBe(false);
  });

  it("leaves Diagnostics on the saved Document", () => {
    const diagnostics = editor.getDiagnostics();
    fontSize().preview(20);

    expect(editor.getDiagnostics()).toBe(diagnostics);
  });
});

// ADR-0032: what the Author saw is kept, as its own step, before they move on.
describe("any other action mid-drag", () => {
  let editor: Editor;
  let root: string;
  let text: string;
  let other: string;
  let section: string;
  let ops: Op[];

  /** A control on the selected text Block, as an Inspector reads it. */
  const control = (name: string) => {
    const found = editor
      .getControls()
      .find((candidate) => candidate.name === name);
    if (!found) throw new Error(`No ${name} control.`);
    return found;
  };

  const fontSizeOf = (blockId: string) =>
    editor.getBlock(blockId)?.props["fontSize"];

  beforeEach(() => {
    editor = createEditor({
      definitions,
      rootType: "email",
      createId: sequentialIds(),
    });
    root = editor.getDocument().root.id;
    text = editor.insertBlock("text", root) ?? "";
    other = editor.insertBlock("text", root) ?? "";
    section = editor.insertBlock("section", root) ?? "";
    editor.select(text);
    ops = [];
    editor.onOp((op) => {
      ops.push(op);
    });
  });

  // `ownStep` is whether the action leaves an undo step of its own above the
  // drag. A text edit's marker does, but with no Text Engine it is dead, so
  // undo steps over it.
  const actions: readonly {
    readonly name: string;
    readonly act: () => unknown;
    readonly ownStep: boolean;
  }[] = [
    {
      name: "selecting another Block",
      act: () => editor.select(other),
      ownStep: false,
    },
    {
      name: "inserting",
      act: () => editor.insertBlock("text", root),
      ownStep: true,
    },
    { name: "deleting", act: () => editor.removeBlock(other), ownStep: true },
    {
      name: "duplicating",
      act: () => editor.duplicateBlock(other),
      ownStep: true,
    },
    {
      name: "moving",
      act: () => editor.moveBlock(other, section, 0),
      ownStep: true,
    },
    {
      name: "switching Stage",
      act: () => {
        editor.setStage("mobile");
      },
      ownStep: false,
    },
    {
      name: "setting another Block",
      act: () => editor.setProp(other, "fontSize", 30),
      ownStep: true,
    },
    {
      name: "setting another prop",
      act: () => editor.setProp(text, "content", "Hi"),
      ownStep: true,
    },
    {
      name: "resetting",
      act: () => {
        control("fontSize").reset();
      },
      ownStep: true,
    },
    {
      name: "entering text editing",
      act: () => editor.edit(text),
      ownStep: false,
    },
    {
      name: "a text edit",
      act: () => editor.markTextEdit(text),
      ownStep: false,
    },
    {
      name: "carrying out a Repair",
      act: () =>
        editor.applyRepair({
          kind: "set-prop",
          blockId: other,
          prop: "fontSize",
          value: 30,
        }),
      ownStep: true,
    },
  ];

  it.each(actions)(
    "commits the drag first, as its own step, on $name",
    ({ act, ownStep }) => {
      control("fontSize").preview(24);

      act();

      expect(editor.getPendingChange()).toBeUndefined();
      expect(ops[0]).toMatchObject({
        kind: "set-prop",
        blockId: text,
        prop: "fontSize",
        value: 24,
      });
      if (ownStep) {
        editor.undo();
        expect(fontSizeOf(text)).toBe(24);
      }
      editor.undo();
      expect(fontSizeOf(text)).toBeUndefined();
    },
  );

  const noOps: readonly {
    readonly name: string;
    readonly act: () => unknown;
  }[] = [
    {
      name: "selecting the selected Block",
      act: () => editor.select(text),
    },
    {
      name: "leaving text editing when not editing",
      act: () => editor.edit(undefined),
    },
    {
      name: "switching to the Stage already shown",
      act: () => {
        editor.setStage("desktop");
      },
    },
  ];

  it.each(noOps)("leaves the drag open on $name", ({ act }) => {
    control("fontSize").preview(24);
    const pending = editor.getPendingChange();

    act();

    expect(editor.getPendingChange()).toBe(pending);
    expect(ops).toEqual([]);
  });

  it("leaves the drag open on entering the text already being edited", () => {
    editor.edit(text);
    control("fontSize").preview(24);
    const pending = editor.getPendingChange();

    expect(editor.edit(text)).toBe(true);

    expect(editor.getPendingChange()).toBe(pending);
    expect(ops).toEqual([]);
  });

  it("commits the drag before clearing an override", () => {
    editor.setStage("mobile");
    editor.setProp(text, "fontSize", 12);
    control("fontSize").preview(24);
    ops = [];

    control("fontSize").clearOverride();

    expect(ops).toMatchObject([
      { stage: "mobile", value: 24, previousValue: 12 },
      { stage: "mobile", value: undefined, previousValue: 24 },
    ]);
    editor.undo();
    expect(editor.getBlock(text)?.mobile).toEqual({ fontSize: 24 });
    editor.undo();
    expect(editor.getBlock(text)?.mobile).toEqual({ fontSize: 12 });
  });

  it("commits the drag on the Stage it was dragged on", () => {
    control("fontSize").preview(24);

    editor.setStage("mobile");

    expect(ops).toHaveLength(1);
    expect(ops[0]).not.toHaveProperty("stage");
    expect(editor.getBlock(text)?.mobile).toBeUndefined();
  });

  it("announces the commit and the action once", () => {
    const heard: string[] = [];
    editor.subscribe(() => {
      heard.push("change");
    });
    editor.subscribeToPendingChange(() => {
      heard.push("pending");
    });
    control("fontSize").preview(24);
    heard.length = 0;

    editor.select(other);

    expect(heard).toEqual(["change", "pending"]);
  });

  it("brings a deleted Block back with the dragged value", () => {
    editor.setPendingChange(other, { fontSize: 24 });
    editor.removeBlock(other);

    editor.undo();

    expect(fontSizeOf(other)).toBe(24);
  });

  it("lands an undo on the value before the drag, and redo brings it back", () => {
    editor.setProp(text, "fontSize", 18);
    control("fontSize").preview(24);

    expect(editor.undo()).toBe(true);
    expect(fontSizeOf(text)).toBe(18);
    expect(editor.getPendingChange()).toBeUndefined();

    expect(editor.redo()).toBe(true);
    expect(fontSizeOf(text)).toBe(24);
  });

  it("commits the drag before a redo too", () => {
    editor.setProp(other, "fontSize", 30);
    editor.undo();
    control("fontSize").preview(24);

    editor.redo();

    // The drag is a new edit, so the future it would have redone is gone.
    expect(fontSizeOf(text)).toBe(24);
    expect(fontSizeOf(other)).toBeUndefined();
    expect(editor.canRedo()).toBe(false);
  });

  it("commits a drag on one prop when another prop of the Block is previewed", () => {
    control("fontSize").preview(24);

    control("content").preview("Hi");

    expect(fontSizeOf(text)).toBe(24);
    expect(ops).toHaveLength(1);
    expect(editor.getPendingChange()).toMatchObject({
      blockId: text,
      ops: [{ prop: "content", value: "Hi" }],
    });
  });

  it("commits a drag on one Block when another Block gets a Pending Change", () => {
    control("fontSize").preview(24);

    editor.setPendingChange(other, { fontSize: 30 });

    expect(fontSizeOf(text)).toBe(24);
    expect(fontSizeOf(other)).toBeUndefined();
    expect(editor.getPendingChange()).toMatchObject({ blockId: other });

    editor.commitPendingChange();
    editor.undo();
    expect(fontSizeOf(text)).toBe(24);
    editor.undo();
    expect(fontSizeOf(text)).toBeUndefined();
  });

  it("keeps the drag open when a Pending Change elsewhere is refused", () => {
    control("fontSize").preview(24);
    const pending = editor.getPendingChange();

    expect(editor.setPendingChange(other, { noSuchProp: 1 })).toBe(false);

    expect(editor.getPendingChange()).toBe(pending);
    expect(ops).toEqual([]);
  });
});

// A peer's edit lands through `applyExternalOps` while the Author drags.
describe("a remote Op mid-drag", () => {
  let editor: Editor;
  let root: string;
  let text: string;
  let other: string;
  let ops: Op[];

  const fontSize = () => {
    const control = editor
      .getControls()
      .find((candidate) => candidate.name === "fontSize");
    if (!control) throw new Error("No font size control.");
    return control;
  };

  const fontSizeOf = (blockId: string) =>
    editor.getBlock(blockId)?.props["fontSize"];

  const shownFontSizeOf = (blockId: string) =>
    editor
      .getDocumentWithPendingChange()
      .root.children?.find((block) => block.id === blockId)?.props["fontSize"];

  /** A peer setting the font size of a Block. */
  const remoteFontSize = (blockId: string, value: number): Op => ({
    kind: "set-prop",
    origin: "peer",
    blockId,
    prop: "fontSize",
    value,
    previousValue: fontSizeOf(blockId),
  });

  /** A peer removing a child of the root. */
  const remoteRemove = (blockId: string): Op => {
    const children = editor.getDocument().root.children ?? [];
    const index = children.findIndex((block) => block.id === blockId);
    const block = children[index];
    if (!block) throw new Error(`No root child ${blockId}.`);
    return { kind: "remove", origin: "peer", parentId: root, index, block };
  };

  beforeEach(() => {
    editor = createEditor({
      definitions,
      rootType: "email",
      createId: sequentialIds(),
    });
    root = editor.getDocument().root.id;
    text = editor.insertBlock("text", root) ?? "";
    other = editor.insertBlock("text", root) ?? "";
    editor.select(text);
    ops = [];
    editor.onOp((op) => {
      ops.push(op);
    });
  });

  it("keeps showing the drag when a peer sets the same prop", () => {
    fontSize().preview(20);
    const pending = editor.getPendingChange();

    editor.applyExternalOps([remoteFontSize(text, 40)]);

    expect(editor.getPendingChange()).toBe(pending);
    expect(fontSizeOf(text)).toBe(40);
    expect(shownFontSizeOf(text)).toBe(20);
  });

  it("wins on commit, and undo lands on the peer's value", () => {
    fontSize().preview(20);
    editor.applyExternalOps([remoteFontSize(text, 40)]);
    ops = [];

    expect(editor.commitPendingChange()).toBe(true);
    expect(ops).toMatchObject([{ value: 20, previousValue: 40 }]);
    expect(fontSizeOf(text)).toBe(20);

    editor.undo();
    expect(fontSizeOf(text)).toBe(40);
  });

  it("drops the drag when a peer removes its Block", () => {
    let told = 0;
    editor.subscribeToPendingChange(() => {
      told += 1;
    });
    fontSize().preview(20);
    told = 0;

    editor.applyExternalOps([remoteRemove(text)]);

    expect(editor.getPendingChange()).toBeUndefined();
    expect(told).toBe(1);
    ops = [];
    expect(editor.commitPendingChange()).toBe(false);
    expect(ops).toEqual([]);
  });

  it("drops the drag when a peer removes an ancestor of its Block", () => {
    const section = editor.insertBlock("section", root) ?? "";
    const inner = editor.insertBlock("text", section) ?? "";
    expect(editor.setPendingChange(inner, { fontSize: 20 })).toBe(true);
    let told = 0;
    editor.subscribeToPendingChange(() => {
      told += 1;
    });

    editor.applyExternalOps([remoteRemove(section)]);

    expect(editor.getPendingChange()).toBeUndefined();
    expect(told).toBe(1);
    ops = [];
    expect(editor.commitPendingChange()).toBe(false);
    expect(ops).toEqual([]);
  });

  it("tells pending listeners after change listeners when it drops the drag", () => {
    fontSize().preview(20);
    const heard: string[] = [];
    editor.subscribe(() => {
      heard.push("change");
    });
    editor.subscribeToPendingChange(() => {
      heard.push("pending");
    });

    editor.applyExternalOps([remoteRemove(text)]);

    expect(heard).toEqual(["change", "pending"]);
  });

  it("leaves the drag alone when a peer edits another Block", () => {
    let told = 0;
    fontSize().preview(20);
    const pending = editor.getPendingChange();
    editor.subscribeToPendingChange(() => {
      told += 1;
    });

    editor.applyExternalOps([remoteFontSize(other, 40), remoteRemove(other)]);

    expect(editor.getPendingChange()).toBe(pending);
    expect(shownFontSizeOf(text)).toBe(20);
    expect(told).toBe(0);
  });

  it("keeps the peer's Ops out of local undo", () => {
    fontSize().preview(20);
    editor.applyExternalOps([remoteFontSize(other, 40)]);
    editor.commitPendingChange();

    editor.undo();
    expect(fontSizeOf(text)).toBeUndefined();
    expect(fontSizeOf(other)).toBe(40);
  });
});

// A control linking several props, like padding on all four sides.
describe("a Pending Change on several props", () => {
  let editor: Editor;
  let text: string;
  let ops: Op[];

  const propsOf = (blockId: string) => editor.getBlock(blockId)?.props;
  const shownPropsOf = (blockId: string) =>
    editor
      .getDocumentWithPendingChange()
      .root.children?.find((block) => block.id === blockId)?.props;

  beforeEach(() => {
    editor = createEditor({
      definitions,
      rootType: "email",
      createId: sequentialIds(),
    });
    text = editor.insertBlock("text", editor.getDocument().root.id) ?? "";
    editor.select(text);
    ops = [];
    editor.onOp((op) => {
      ops.push(op);
    });
  });

  it("shows every prop together and holds one Op per prop", () => {
    expect(editor.setPendingChange(text, { fontSize: 20, content: "Hi" })).toBe(
      true,
    );

    expect(shownPropsOf(text)).toMatchObject({ fontSize: 20, content: "Hi" });
    expect(propsOf(text)).toEqual({});
    expect(editor.getPendingChange()).toEqual({
      blockId: text,
      ops: [
        expect.objectContaining({ prop: "fontSize", value: 20 }),
        expect.objectContaining({ prop: "content", value: "Hi" }),
      ],
    });
    expect(ops).toEqual([]);
  });

  it("commits as one undo step, and one undo takes every prop back", () => {
    const changes: string[] = [];
    editor.subscribe(() => {
      changes.push("change");
    });

    editor.setPendingChange(text, { fontSize: 20, content: "Hi" });
    editor.setPendingChange(text, { fontSize: 24, content: "Hello" });
    expect(editor.commitPendingChange()).toBe(true);

    expect(propsOf(text)).toEqual({ fontSize: 24, content: "Hello" });
    expect(ops).toMatchObject([
      { kind: "set-prop", prop: "fontSize", value: 24 },
      { kind: "set-prop", prop: "content", value: "Hello" },
    ]);
    expect(changes).toEqual(["change"]);

    editor.undo();
    expect(propsOf(text)).toEqual({});
    expect(editor.canUndo()).toBe(true);

    editor.redo();
    expect(propsOf(text)).toEqual({ fontSize: 24, content: "Hello" });
  });

  it("makes no Op for a prop already at its stored value", () => {
    editor.setProp(text, "fontSize", 20);
    ops = [];

    editor.setPendingChange(text, { fontSize: 20, content: "Hi" });

    expect(editor.getPendingChange()?.ops).toMatchObject([
      { prop: "content", value: "Hi" },
    ]);
    editor.commitPendingChange();
    expect(ops).toMatchObject([{ prop: "content", value: "Hi" }]);
  });

  it("writes nothing when no prop changes", () => {
    editor.setProp(text, "fontSize", 20);
    editor.setProp(text, "content", "Hi");
    const saved = editor.getDocument();
    ops = [];

    expect(editor.setPendingChange(text, { fontSize: 20, content: "Hi" })).toBe(
      true,
    );
    expect(editor.getPendingChange()?.ops).toEqual([]);
    expect(editor.commitPendingChange()).toBe(true);

    expect(ops).toEqual([]);
    expect(editor.getDocument()).toBe(saved);
  });

  it("opens nothing when any prop would be refused", () => {
    expect(editor.setPendingChange(text, { fontSize: 20, noSuchProp: 1 })).toBe(
      false,
    );
    expect(editor.getPendingChange()).toBeUndefined();

    editor.setStage("mobile");
    // Font size is Overridable; rich text is not.
    expect(editor.setPendingChange(text, { fontSize: 12, content: "Hi" })).toBe(
      false,
    );
    expect(editor.getPendingChange()).toBeUndefined();

    expect(editor.setPendingChange(text, {})).toBe(false);
    expect(ops).toEqual([]);
  });

  it("leaves the open drag alone when a refused Pending Change names more props", () => {
    editor.setPendingChange(text, { fontSize: 20, content: "Hi" });
    const pending = editor.getPendingChange();

    expect(editor.setPendingChange(text, { fontSize: 24, noSuchProp: 1 })).toBe(
      false,
    );

    expect(editor.getPendingChange()).toBe(pending);
  });

  it("replaces the open props on the same Block rather than merging", () => {
    editor.setPendingChange(text, { fontSize: 20, content: "Hi" });

    editor.setPendingChange(text, { fontSize: 24 });

    expect(ops).toEqual([]);
    expect(editor.getPendingChange()?.ops).toMatchObject([
      { prop: "fontSize", value: 24 },
    ]);
    expect(shownPropsOf(text)).toEqual({ fontSize: 24 });

    editor.commitPendingChange();
    expect(propsOf(text)).toEqual({ fontSize: 24 });
  });

  it("is committed as its own step when a control drags one of its props", () => {
    editor.setPendingChange(text, { fontSize: 20, content: "Hi" });

    editor
      .getControls()
      .find((control) => control.name === "fontSize")
      ?.preview(24);

    expect(propsOf(text)).toEqual({ fontSize: 20, content: "Hi" });
    expect(editor.getPendingChange()?.ops).toMatchObject([
      { prop: "fontSize", value: 24, previousValue: 20 },
    ]);
  });

  it("tells pending listeners when the same Block's props are replaced", () => {
    editor.setPendingChange(text, { fontSize: 20, content: "Hi" });
    const heard: string[] = [];
    editor.subscribeToPendingChange(() => {
      heard.push("pending");
    });

    editor.setPendingChange(text, { fontSize: 20 });

    expect(heard).toEqual(["pending"]);
  });

  it("keeps the drag as its own step when a control commits one of its props", () => {
    editor.setPendingChange(text, { fontSize: 20, content: "Hi" });

    editor
      .getControls()
      .find((control) => control.name === "fontSize")
      ?.commit(24);

    expect(propsOf(text)).toEqual({ fontSize: 24, content: "Hi" });
    editor.undo();
    expect(propsOf(text)).toEqual({ fontSize: 20, content: "Hi" });
  });

  it("moves the neighbour of a width among the props, and undoes all together", () => {
    editor = createEditor({
      definitions: definitionsDividing,
      rootType: "email",
      createId: sequentialIds(),
    });
    const grid = editor.insertBlock("grid", editor.getDocument().root.id) ?? "";
    // A grid arrives with its two cells.
    const [left, right] = editor.getBlock(grid)?.children ?? [];
    if (!left || !right) throw new Error("No cells.");

    expect(editor.setPendingChange(left.id, { share: 70, padding: 8 })).toBe(
      true,
    );
    expect(editor.getPendingChange()?.ops).toMatchObject([
      { blockId: left.id, prop: "share", value: 70 },
      { blockId: right.id, prop: "share", value: 30 },
      { blockId: left.id, prop: "padding", value: 8 },
    ]);

    editor.commitPendingChange();
    editor.undo();
    expect(editor.getBlock(left.id)?.props).toEqual(left.props);
    expect(editor.getBlock(right.id)?.props).toEqual(right.props);
  });
});
