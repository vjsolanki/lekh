import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEditor, type Editor, type Op } from "../../index";
import { definitions, sequentialIds } from "../../testing/blocks";

// ADR-0032: a Consumer who wires `onChange` straight to `set` still gets one
// undo step per drag. The fold is checked here, through the editor.
describe("the History fold", () => {
  let editor: Editor;
  let text: string;
  let ops: Op[];
  let changes: number;

  const fontSizeOf = (blockId: string) =>
    editor.getBlock(blockId)?.props["fontSize"];

  /** The font size control, with the Block selected so it is offered. */
  const fontSize = () => {
    editor.select(text);
    const control = editor
      .getControls()
      .find((candidate) => candidate.name === "fontSize");
    if (!control) throw new Error("No font size control.");
    return control;
  };

  /** Several sets of one prop, each `gap` ms after the last. */
  const setEach = (
    blockId: string,
    values: readonly unknown[],
    gap: number,
    prop = "fontSize",
  ) => {
    for (const value of values) {
      vi.advanceTimersByTime(gap);
      editor.setProp(blockId, prop, value);
    }
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    editor = createEditor({
      definitions,
      rootType: "email",
      createId: sequentialIds(),
    });
    text = editor.insertBlock("text", editor.getDocument().root.id) ?? "";
    // Well past the insertion, so nothing here folds into it by accident.
    vi.advanceTimersByTime(10_000);
    ops = [];
    editor.onOp((op) => {
      ops.push(op);
    });
    changes = 0;
    editor.subscribe(() => {
      changes += 1;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("folds sets within the window into one undo step", () => {
    const before = fontSizeOf(text);

    setEach(text, [20, 22, 24], 100);
    ops = [];
    editor.undo();

    expect(fontSizeOf(text)).toBe(before);
    expect(ops).toEqual([
      {
        kind: "set-prop",
        origin: "local",
        blockId: text,
        prop: "fontSize",
        value: before,
        previousValue: 24,
      },
    ]);
    // The insertion is still there to undo, so the fold took one step.
    expect(editor.getBlock(text)).toBeDefined();
  });

  it("brings the whole run back in one redo", () => {
    setEach(text, [20, 22, 24], 100);
    editor.undo();
    ops = [];
    editor.redo();

    expect(fontSizeOf(text)).toBe(24);
    expect(ops).toHaveLength(1);
  });

  it("still sends every set's Op and announcement", () => {
    setEach(text, [20, 22, 24], 100);

    expect(ops.map((op) => op.kind === "set-prop" && op.value)).toEqual([
      20, 22, 24,
    ]);
    expect(changes).toBe(3);
  });

  it("keeps sets spaced past the window as separate steps", () => {
    setEach(text, [20, 22, 24], 600);

    editor.undo();
    expect(fontSizeOf(text)).toBe(22);
    editor.undo();
    expect(fontSizeOf(text)).toBe(20);
  });

  it("measures the window from the last set, not the first", () => {
    setEach(text, [20, 22, 24, 26, 28, 30], 400);
    const before = fontSizeOf(text);
    editor.undo();

    expect(fontSizeOf(text)).not.toBe(before);
    expect(editor.getBlock(text)).toBeDefined();
    editor.undo();
    expect(editor.getBlock(text)).toBeUndefined();
  });

  it("honours newGroupDelay", () => {
    editor = createEditor({
      definitions,
      rootType: "email",
      createId: sequentialIds(),
      newGroupDelay: 50,
    });
    text = editor.insertBlock("text", editor.getDocument().root.id) ?? "";
    vi.advanceTimersByTime(10_000);

    const before = fontSizeOf(text);
    setEach(text, [20, 22], 40);
    setEach(text, [24], 60);

    editor.undo();
    expect(fontSizeOf(text)).toBe(22);
    editor.undo();
    expect(editor.getBlock(text)).toBeDefined();
    expect(fontSizeOf(text)).toBe(before);
  });

  it("never folds a different Block", () => {
    const other =
      editor.insertBlock("text", editor.getDocument().root.id) ?? "";
    vi.advanceTimersByTime(10_000);

    setEach(text, [20], 100);
    setEach(other, [30], 100);

    editor.undo();
    expect(fontSizeOf(other)).not.toBe(30);
    expect(fontSizeOf(text)).toBe(20);
  });

  it("never folds a different prop", () => {
    setEach(text, [20], 100);
    setEach(text, ["Hello"], 100, "content");

    editor.undo();
    expect(fontSizeOf(text)).toBe(20);
  });

  it("never folds a different Stage", () => {
    setEach(text, [20], 100);
    editor.setStage("mobile");
    setEach(text, [14], 100);

    editor.undo();
    expect(editor.getBlock(text)?.mobile?.["fontSize"]).toBeUndefined();
    expect(fontSizeOf(text)).toBe(20);
  });

  it("is broken by any other entry", () => {
    setEach(text, [20], 100);
    vi.advanceTimersByTime(100);
    editor.insertBlock("text", editor.getDocument().root.id);
    setEach(text, [22], 100);

    editor.undo();
    expect(fontSizeOf(text)).toBe(20);
  });

  it("is broken by an undo", () => {
    setEach(text, [20, 22], 600);
    editor.undo();
    setEach(text, [24], 100);

    editor.undo();
    expect(fontSizeOf(text)).toBe(20);
  });

  it("is broken by a redo", () => {
    setEach(text, [20], 600);
    setEach(text, [22], 600);
    editor.undo();
    editor.undo();
    editor.redo();
    setEach(text, [24], 100);

    editor.undo();
    expect(fontSizeOf(text)).toBe(20);
  });

  it("is broken by a remote Op on the same Block and prop", () => {
    setEach(text, [20], 100);
    vi.advanceTimersByTime(100);
    editor.applyExternalOps([
      {
        kind: "set-prop",
        origin: "remote",
        blockId: text,
        prop: "fontSize",
        value: 40,
        previousValue: 20,
      },
    ]);
    setEach(text, [22], 100);

    editor.undo();
    expect(fontSizeOf(text)).toBe(40);
  });

  it("is not broken by a remote Op on another prop", () => {
    const before = fontSizeOf(text);
    setEach(text, [20], 100);
    vi.advanceTimersByTime(100);
    editor.applyExternalOps([
      {
        kind: "set-prop",
        origin: "remote",
        blockId: text,
        prop: "content",
        value: "Hello",
        previousValue: editor.getBlock(text)?.props["content"],
      },
    ]);
    setEach(text, [22], 100);

    editor.undo();
    expect(fontSizeOf(text)).toBe(before);
  });

  it("leaves no undo step when the run ends on its first value", () => {
    const before = fontSizeOf(text);

    setEach(text, [20, 22, before], 100);
    editor.undo();

    expect(editor.getBlock(text)).toBeUndefined();
  });

  it("starts afresh after a run that came back to its first value", () => {
    const before = fontSizeOf(text);

    setEach(text, [20, before, 30], 100);
    editor.undo();

    expect(fontSizeOf(text)).toBe(before);
    expect(editor.getBlock(text)).toBeDefined();
  });

  it("never folds a reset, which is a button and not a drag", () => {
    setEach(text, [20], 100);
    vi.advanceTimersByTime(100);
    fontSize().reset();

    editor.undo();
    expect(fontSizeOf(text)).toBe(20);
  });

  it("keeps two quick drags as two steps", () => {
    editor.setPendingChange(text, { fontSize: 20 });
    editor.commitPendingChange();
    vi.advanceTimersByTime(100);
    editor.setPendingChange(text, { fontSize: 24 });
    editor.commitPendingChange();

    editor.undo();
    expect(fontSizeOf(text)).toBe(20);
  });

  it("never folds a set into a drag, or a drag into a set", () => {
    setEach(text, [20], 100);
    vi.advanceTimersByTime(100);
    editor.setPendingChange(text, { fontSize: 24 });
    editor.commitPendingChange();
    setEach(text, [26], 100);

    editor.undo();
    expect(fontSizeOf(text)).toBe(24);
    editor.undo();
    expect(fontSizeOf(text)).toBe(20);
  });

  describe("through a control's commit", () => {
    it("is a set when nothing is pending, Ops and change calls alike", () => {
      const control = fontSize();
      ops = [];
      changes = 0;
      vi.advanceTimersByTime(100);
      control.commit(20);
      const committed = { ops: [...ops], changes };

      editor.undo();
      vi.advanceTimersByTime(10_000);
      ops = [];
      changes = 0;
      editor.setProp(text, "fontSize", 20);

      expect({ ops, changes }).toEqual(committed);
    });

    it("folds ten quick arrow presses into one undo step", () => {
      const before = fontSizeOf(text);

      for (let press = 1; press <= 10; press += 1) {
        vi.advanceTimersByTime(50);
        fontSize().commit(16 + press);
      }
      expect(ops).toHaveLength(10);
      editor.undo();

      expect(fontSizeOf(text)).toBe(before);
      expect(editor.getBlock(text)).toBeDefined();
    });

    it("folds into a set just before it, as a set would", () => {
      const before = fontSizeOf(text);

      setEach(text, [20], 100);
      vi.advanceTimersByTime(100);
      fontSize().commit(22);
      editor.undo();

      expect(fontSizeOf(text)).toBe(before);
    });

    it("keeps two quick drags ended on a value as two steps", () => {
      fontSize().preview(20);
      fontSize().commit(21);
      vi.advanceTimersByTime(100);
      fontSize().preview(24);
      fontSize().commit(25);

      editor.undo();
      expect(fontSizeOf(text)).toBe(21);
    });

    it("keeps a drag ended on a value apart from the sets around it", () => {
      setEach(text, [20], 100);
      vi.advanceTimersByTime(100);
      fontSize().preview(23);
      fontSize().commit(24);
      vi.advanceTimersByTime(100);
      fontSize().commit(26);

      editor.undo();
      expect(fontSizeOf(text)).toBe(24);
      editor.undo();
      expect(fontSizeOf(text)).toBe(20);
    });
  });
});
